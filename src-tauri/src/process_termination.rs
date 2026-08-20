use std::{
    process::Child,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::{
    os::windows::{io::AsRawHandle, process::CommandExt},
    process::Command,
    ptr,
};

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
        },
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
            QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
        },
        Threading::{
            CREATE_NO_WINDOW, CREATE_SUSPENDED, OpenThread, ResumeThread, THREAD_SUSPEND_RESUME,
        },
    },
};

const FORCE_STOP_TIMEOUT: Duration = Duration::from_secs(2);

#[cfg(windows)]
pub(crate) fn configure_windowless_command(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(windows)]
pub(crate) fn configure_process_tree_command(command: &mut Command) {
    command.creation_flags(CREATE_SUSPENDED | CREATE_NO_WINDOW);
}

pub(crate) struct ProcessTree {
    child: Child,
    #[cfg(windows)]
    job: HANDLE,
}

impl ProcessTree {
    #[allow(unused_mut)]
    pub(crate) fn attach(mut child: Child) -> Result<Self, String> {
        #[cfg(windows)]
        {
            let job = create_kill_on_close_job().inspect_err(|_| {
                let _ = child.kill();
                let _ = child.wait();
            })?;
            let process = child.as_raw_handle() as HANDLE;
            if unsafe { AssignProcessToJobObject(job, process) } == 0 {
                let error = std::io::Error::last_os_error();
                unsafe {
                    CloseHandle(job);
                }
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "failed to assign runtime to a Windows Job Object: {error}"
                ));
            }
            if let Err(error) = resume_main_thread(child.id()) {
                unsafe {
                    CloseHandle(job);
                }
                let _ = child.wait();
                return Err(error);
            }
            Ok(Self { child, job })
        }

        #[cfg(not(windows))]
        Ok(Self { child })
    }

    pub(crate) fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        self.child.try_wait()
    }

    pub(crate) fn is_tree_alive(&mut self) -> Result<bool, String> {
        self.child
            .try_wait()
            .map_err(|error| format!("failed to inspect runtime process: {error}"))?;
        #[cfg(unix)]
        {
            let process_group = i32::try_from(self.child.id()).map_err(|_| {
                "runtime process id does not fit the platform process id type".to_string()
            })?;
            process_group_exists(process_group)
        }
        #[cfg(windows)]
        {
            Ok(active_job_processes(self.job)? > 0)
        }
    }
}

#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.job);
        }
    }
}

pub(crate) fn stop_process_tree(
    process: &mut ProcessTree,
    graceful_timeout: Duration,
) -> Result<(), String> {
    stop_process_tree_with_timeout(process, graceful_timeout, FORCE_STOP_TIMEOUT)
}

pub(crate) fn run_command_with_timeout(
    command: &mut std::process::Command,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    use std::process::Stdio;

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    configure_process_tree_command(command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to start helper process: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .expect("piped stdout missing from helper process");
    let stderr = child
        .stderr
        .take()
        .expect("piped stderr missing from helper process");
    let stdout_rx = spawn_output_reader(stdout);
    let stderr_rx = spawn_output_reader(stderr);

    let mut tree = ProcessTree::attach(child)?;
    let deadline = Instant::now() + timeout;
    let status = loop {
        match tree
            .try_wait()
            .map_err(|error| format!("failed to inspect helper process: {error}"))?
        {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                stop_process_tree(&mut tree, Duration::from_secs(1))?;
                return Err(format!(
                    "helper process did not finish within {} seconds",
                    timeout.as_secs()
                ));
            }
            None => thread::sleep(Duration::from_millis(50)),
        }
    };

    let _ = stop_process_tree(&mut tree, Duration::from_secs(1));
    let stdout = recv_helper_output(stdout_rx, deadline, "stdout")?;
    let stderr = recv_helper_output(stderr_rx, deadline, "stderr")?;
    Ok(std::process::Output {
        status,
        stdout,
        stderr,
    })
}

fn spawn_output_reader(
    reader: impl std::io::Read + Send + 'static,
) -> mpsc::Receiver<std::io::Result<Vec<u8>>> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(read_all(reader));
    });
    rx
}

fn recv_helper_output(
    rx: mpsc::Receiver<std::io::Result<Vec<u8>>>,
    deadline: Instant,
    label: &str,
) -> Result<Vec<u8>, String> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    let wait = if remaining.is_zero() {
        Duration::from_millis(100)
    } else {
        remaining
    };
    match rx.recv_timeout(wait) {
        Ok(Ok(bytes)) => Ok(bytes),
        Ok(Err(error)) => Err(format!("failed to read helper {label}: {error}")),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(format!(
            "helper {label} drain exceeded the command deadline"
        )),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(format!(
            "helper {label} reader stopped before producing output"
        )),
    }
}

fn read_all(mut reader: impl std::io::Read) -> std::io::Result<Vec<u8>> {
    let mut buffer = Vec::new();
    reader.read_to_end(&mut buffer)?;
    Ok(buffer)
}

#[cfg(unix)]
fn stop_process_tree_with_timeout(
    process: &mut ProcessTree,
    graceful_timeout: Duration,
    force_timeout: Duration,
) -> Result<(), String> {
    if !process.is_tree_alive()? {
        return Ok(());
    }
    let process_group = i32::try_from(process.child.id())
        .map_err(|_| "runtime process id does not fit the platform process id type".to_string())?;
    signal_process_group(process_group, libc::SIGINT)?;
    if wait_for_process_group_exit(&mut process.child, process_group, graceful_timeout)? {
        return Ok(());
    }

    signal_process_group(process_group, libc::SIGKILL)?;
    if wait_for_process_group_exit(&mut process.child, process_group, force_timeout)? {
        Ok(())
    } else {
        Err("runtime process group remained alive after forced termination".to_string())
    }
}

#[cfg(unix)]
fn signal_process_group(process_group: i32, signal: i32) -> Result<(), String> {
    if unsafe { libc::kill(-process_group, signal) } == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if signal_group_error_is_delivered(error.raw_os_error()) {
        Ok(())
    } else {
        Err(format!("failed to signal runtime process group: {error}"))
    }
}

#[cfg(unix)]
fn signal_group_error_is_delivered(raw_os_error: Option<i32>) -> bool {
    matches!(raw_os_error, Some(libc::ESRCH) | Some(libc::EPERM))
}

#[cfg(unix)]
fn wait_for_process_group_exit(
    child: &mut Child,
    process_group: i32,
    timeout: Duration,
) -> Result<bool, String> {
    let deadline = Instant::now() + timeout;
    loop {
        child
            .try_wait()
            .map_err(|error| format!("failed to inspect runtime process: {error}"))?;
        let exists = process_group_exists(process_group)?;
        if !exists {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(unix)]
fn process_group_exists(process_group: i32) -> Result<bool, String> {
    if unsafe { libc::kill(-process_group, 0) } == 0 {
        return Ok(true);
    }
    let error = std::io::Error::last_os_error();
    match error.raw_os_error() {
        Some(libc::ESRCH) => Ok(false),
        Some(libc::EPERM) => Ok(true),
        _ => Err(format!("failed to inspect runtime process group: {error}")),
    }
}

#[cfg(windows)]
fn stop_process_tree_with_timeout(
    process: &mut ProcessTree,
    _graceful_timeout: Duration,
    force_timeout: Duration,
) -> Result<(), String> {
    if !process.is_tree_alive()? {
        return Ok(());
    }
    if unsafe { TerminateJobObject(process.job, 1) } == 0 {
        return Err(format!(
            "failed to terminate runtime Windows Job Object: {}",
            std::io::Error::last_os_error()
        ));
    }
    if wait_for_job_exit(process, force_timeout)? {
        Ok(())
    } else {
        Err("runtime process tree remained alive after forced termination".to_string())
    }
}

#[cfg(windows)]
fn wait_for_job_exit(process: &mut ProcessTree, timeout: Duration) -> Result<bool, String> {
    let deadline = Instant::now() + timeout;
    loop {
        process
            .child
            .try_wait()
            .map_err(|error| format!("failed to inspect runtime process: {error}"))?;
        if active_job_processes(process.job)? == 0 {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(windows)]
fn create_kill_on_close_job() -> Result<HANDLE, String> {
    let job = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
    if job.is_null() {
        return Err(format!(
            "failed to create runtime Windows Job Object: {}",
            std::io::Error::last_os_error()
        ));
    }

    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let configured = unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            ptr::from_ref(&limits).cast(),
            std::mem::size_of_val(&limits) as u32,
        )
    };
    if configured == 0 {
        let error = std::io::Error::last_os_error();
        unsafe {
            CloseHandle(job);
        }
        return Err(format!(
            "failed to configure runtime Windows Job Object: {error}"
        ));
    }
    Ok(job)
}

#[cfg(windows)]
fn active_job_processes(job: HANDLE) -> Result<u32, String> {
    let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
    let queried = unsafe {
        QueryInformationJobObject(
            job,
            JobObjectBasicAccountingInformation,
            ptr::from_mut(&mut accounting).cast(),
            std::mem::size_of_val(&accounting) as u32,
            ptr::null_mut(),
        )
    };
    if queried == 0 {
        Err(format!(
            "failed to inspect runtime Windows Job Object: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(accounting.ActiveProcesses)
    }
}

#[cfg(windows)]
fn resume_main_thread(process_id: u32) -> Result<(), String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(format!(
            "failed to enumerate suspended runtime threads: {}",
            std::io::Error::last_os_error()
        ));
    }

    let mut entry = THREADENTRY32 {
        dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
        ..THREADENTRY32::default()
    };
    let mut available = unsafe { Thread32First(snapshot, &mut entry) } != 0;
    while available {
        if entry.th32OwnerProcessID == process_id {
            let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
            if thread.is_null() {
                unsafe {
                    CloseHandle(snapshot);
                }
                return Err(format!(
                    "failed to open suspended runtime thread: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let previous_count = unsafe { ResumeThread(thread) };
            unsafe {
                CloseHandle(thread);
                CloseHandle(snapshot);
            }
            if previous_count == u32::MAX {
                return Err(format!(
                    "failed to resume runtime process: {}",
                    std::io::Error::last_os_error()
                ));
            }
            return Ok(());
        }
        available = unsafe { Thread32Next(snapshot, &mut entry) } != 0;
    }
    unsafe {
        CloseHandle(snapshot);
    }
    Err("could not find the suspended runtime main thread".to_string())
}

#[cfg(all(test, unix))]
mod tests {
    use std::{
        os::unix::process::CommandExt,
        process::Command,
        thread,
        time::{Duration, Instant},
    };

    use super::{ProcessTree, run_command_with_timeout, stop_process_tree_with_timeout};

    #[test]
    fn force_stop_waits_for_an_entire_process_group() {
        let mut command = Command::new("sh");
        command
            .args(["-c", "trap '' INT; (trap '' INT; sleep 60) & wait"])
            .process_group(0);
        let child = match command.spawn() {
            Ok(child) => child,
            Err(error) => panic!("test process group must start: {error}"),
        };
        let mut process = match ProcessTree::attach(child) {
            Ok(process) => process,
            Err(error) => panic!("test process tree must attach: {error}"),
        };
        thread::sleep(Duration::from_millis(50));

        stop_process_tree_with_timeout(
            &mut process,
            Duration::from_millis(50),
            Duration::from_secs(2),
        )
        .expect("the complete test process group must stop");
        assert!(
            process
                .child
                .try_wait()
                .expect("test child status must be readable")
                .is_some(),
            "the direct test child must be reaped"
        );
    }

    #[test]
    fn timed_helper_command_captures_output() {
        let mut command = Command::new("sh");
        command.args(["-c", "echo out; echo err >&2"]);

        let output = run_command_with_timeout(&mut command, Duration::from_secs(10))
            .expect("fast helper command must finish");

        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout), "out\n");
        assert_eq!(String::from_utf8_lossy(&output.stderr), "err\n");
    }

    #[test]
    fn timed_helper_does_not_block_on_inherited_pipes() {
        let mut command = Command::new("sh");
        command.args(["-c", "(sleep 30) & exit 0"]);

        let started = Instant::now();
        let output = run_command_with_timeout(&mut command, Duration::from_secs(5))
            .expect("the direct helper child already exited");

        assert!(output.status.success());
        assert!(
            started.elapsed() < Duration::from_secs(4),
            "inherited descendant pipes must not block the supervisor thread"
        );
    }

    #[test]
    fn timed_helper_command_is_killed_at_the_deadline() {
        let mut command = Command::new("sh");
        command.args(["-c", "echo started; sleep 60; echo done"]);

        let started = Instant::now();
        let result = run_command_with_timeout(&mut command, Duration::from_millis(300));

        assert!(result.is_err(), "hung helper command must time out");
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "timeout must not wait for the child to exit on its own"
        );
    }

    #[test]
    fn group_signal_treats_eperm_as_delivered() {
        assert!(super::signal_group_error_is_delivered(Some(libc::ESRCH)));
        assert!(super::signal_group_error_is_delivered(Some(libc::EPERM)));
        assert!(!super::signal_group_error_is_delivered(Some(libc::EINVAL)));
        assert!(!super::signal_group_error_is_delivered(None));
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use std::{process::Command, thread, time::Duration};

    use super::{
        ProcessTree, active_job_processes, configure_process_tree_command,
        configure_windowless_command, stop_process_tree_with_timeout,
    };

    const NO_CONSOLE_CHECK: &str = r#"Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition '[System.Runtime.InteropServices.DllImport("Kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();'; if ([Win32.NativeMethods]::GetConsoleWindow() -ne [System.IntPtr]::Zero) { exit 1 }"#;

    #[test]
    fn windowless_helper_process_has_no_console() {
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            NO_CONSOLE_CHECK,
        ]);
        configure_windowless_command(&mut command);

        let output = command
            .output()
            .expect("windowless PowerShell helper must start");
        assert!(
            output.status.success(),
            "windowless helper unexpectedly owned a console: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn suspended_runtime_process_has_no_console() {
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            NO_CONSOLE_CHECK,
        ]);
        configure_process_tree_command(&mut command);
        let child = command
            .spawn()
            .expect("suspended windowless runtime must start");
        let mut process =
            ProcessTree::attach(child).expect("suspended windowless runtime must enter the job");
        let status = process
            .child
            .wait()
            .expect("windowless runtime status must be readable");

        assert!(status.success(), "runtime unexpectedly owned a console");
    }

    #[test]
    fn suspended_parent_cannot_spawn_outside_the_job() {
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoProfile",
            "-Command",
            "$null = Start-Process powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep 60' -PassThru; Start-Sleep 60",
        ]);
        configure_process_tree_command(&mut command);
        let child = match command.spawn() {
            Ok(child) => child,
            Err(error) => panic!("suspended test parent must start: {error}"),
        };
        let mut process = match ProcessTree::attach(child) {
            Ok(process) => process,
            Err(error) => panic!("test parent must enter the job: {error}"),
        };
        thread::sleep(Duration::from_millis(500));

        if let Err(error) = stop_process_tree_with_timeout(
            &mut process,
            Duration::from_millis(100),
            Duration::from_secs(2),
        ) {
            panic!("the complete Windows test job must stop: {error}");
        }
        let active_processes = match active_job_processes(process.job) {
            Ok(active_processes) => active_processes,
            Err(error) => panic!("test job must remain queryable: {error}"),
        };
        assert_eq!(active_processes, 0);
    }
}
