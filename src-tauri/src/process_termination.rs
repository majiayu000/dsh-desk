use std::{
    process::Child,
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::process::Command;

const FORCE_STOP_TIMEOUT: Duration = Duration::from_secs(2);

pub(crate) fn stop_process_tree(
    child: &mut Child,
    graceful_timeout: Duration,
) -> Result<(), String> {
    stop_process_tree_with_timeout(child, graceful_timeout, FORCE_STOP_TIMEOUT)
}

#[cfg(unix)]
fn stop_process_tree_with_timeout(
    child: &mut Child,
    graceful_timeout: Duration,
    force_timeout: Duration,
) -> Result<(), String> {
    let process_group = i32::try_from(child.id())
        .map_err(|_| "runtime process id does not fit the platform process id type".to_string())?;
    signal_process_group(process_group, libc::SIGINT)?;
    if wait_for_process_group_exit(child, process_group, graceful_timeout)? {
        return Ok(());
    }

    signal_process_group(process_group, libc::SIGKILL)?;
    if wait_for_process_group_exit(child, process_group, force_timeout)? {
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
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(format!("failed to signal runtime process group: {error}"))
    }
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
        let exists = if unsafe { libc::kill(-process_group, 0) } == 0 {
            true
        } else {
            let error = std::io::Error::last_os_error();
            match error.raw_os_error() {
                Some(libc::ESRCH) => false,
                Some(libc::EPERM) => true,
                _ => return Err(format!("failed to inspect runtime process group: {error}")),
            }
        };
        if !exists {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(windows)]
fn stop_process_tree_with_timeout(
    child: &mut Child,
    graceful_timeout: Duration,
    force_timeout: Duration,
) -> Result<(), String> {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return Ok(());
    }
    let process_id = child.id().to_string();
    let _ = Command::new("taskkill.exe")
        .args(["/PID", &process_id, "/T"])
        .status();
    if wait_for_child_exit(child, graceful_timeout)? {
        return Ok(());
    }

    let status = Command::new("taskkill.exe")
        .args(["/PID", &process_id, "/T", "/F"])
        .status()
        .map_err(|error| format!("failed to force-stop runtime process tree: {error}"))?;
    if !status.success() && !matches!(child.try_wait(), Ok(Some(_))) {
        return Err(format!(
            "taskkill failed to stop runtime process tree with status {status}"
        ));
    }
    if wait_for_child_exit(child, force_timeout)? {
        Ok(())
    } else {
        Err("runtime process tree remained alive after forced termination".to_string())
    }
}

#[cfg(windows)]
fn wait_for_child_exit(child: &mut Child, timeout: Duration) -> Result<bool, String> {
    let deadline = Instant::now() + timeout;
    loop {
        if child
            .try_wait()
            .map_err(|error| format!("failed to inspect runtime process: {error}"))?
            .is_some()
        {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::{os::unix::process::CommandExt, process::Command, thread, time::Duration};

    use super::stop_process_tree_with_timeout;

    #[test]
    fn force_stop_waits_for_an_entire_process_group() {
        let mut command = Command::new("sh");
        command
            .args(["-c", "trap '' INT; (trap '' INT; sleep 60) & wait"])
            .process_group(0);
        let mut child = command.spawn().expect("test process group must start");
        thread::sleep(Duration::from_millis(50));

        stop_process_tree_with_timeout(
            &mut child,
            Duration::from_millis(50),
            Duration::from_secs(2),
        )
        .expect("the complete test process group must stop");
        assert!(
            child
                .try_wait()
                .expect("test child status must be readable")
                .is_some(),
            "the direct test child must be reaped"
        );
    }
}
