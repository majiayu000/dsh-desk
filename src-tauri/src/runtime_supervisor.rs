#[path = "runtime_resolve.rs"]
mod runtime_resolve;

use std::{
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender},
    },
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{Emitter, Manager};
use url::Url;

use crate::harness_command::harness_command;
use crate::plugin_manager::{
    PluginCommandRequest, PluginCommandResult, PluginInspection, execute_plugin_command,
    inspect_plugin_source,
};
#[cfg(windows)]
use crate::process_termination::configure_process_tree_command;
use crate::process_termination::{ProcessTree, stop_process_tree};
use crate::window_manager::{navigate_to_runtime, restore_bootstrap};
use runtime_resolve::resolve_runtime;

const START_TIMEOUT: Duration = Duration::from_secs(20);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(5);
const STOP_TIMEOUT: Duration = Duration::from_secs(5);
const FORCE_STOP_WINDOW: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RuntimePhase {
    Stopped,
    Starting,
    Ready,
    Stopping,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub phase: RuntimePhase,
    pub url: Option<String>,
    pub error_code: Option<String>,
    pub message: Option<String>,
}

impl Default for RuntimeStatus {
    fn default() -> Self {
        Self {
            phase: RuntimePhase::Stopped,
            url: None,
            error_code: None,
            message: None,
        }
    }
}

pub(crate) enum RuntimeCommand {
    Restart,
    Plugin(
        PluginCommandRequest,
        Sender<Result<PluginCommandResult, String>>,
    ),
    InspectPlugin(String, Sender<Result<PluginInspection, String>>),
    Shutdown(SyncSender<()>, Sender<Result<(), String>>),
}

#[derive(Clone)]
pub struct RuntimeHandle {
    status: Arc<Mutex<RuntimeStatus>>,
    command_tx: Sender<RuntimeCommand>,
    shutdown_confirmed: Arc<AtomicBool>,
}

impl RuntimeHandle {
    pub fn new() -> (Self, Receiver<RuntimeCommand>) {
        let (command_tx, command_rx) = mpsc::channel();
        (
            Self {
                status: Arc::new(Mutex::new(RuntimeStatus::default())),
                command_tx,
                shutdown_confirmed: Arc::new(AtomicBool::new(false)),
            },
            command_rx,
        )
    }

    pub fn status(&self) -> RuntimeStatus {
        self.status
            .lock()
            .expect("runtime status mutex poisoned")
            .clone()
    }

    pub fn restart(&self) -> Result<(), String> {
        self.invalidate_shutdown_confirmation();
        self.command_tx
            .send(RuntimeCommand::Restart)
            .map_err(|_| "runtime supervisor is not running".to_string())
    }

    pub fn run_plugin(&self, request: PluginCommandRequest) -> Result<PluginCommandResult, String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.command_tx
            .send(RuntimeCommand::Plugin(request, reply_tx))
            .map_err(|_| "runtime supervisor is not running".to_string())?;
        reply_rx
            .recv()
            .map_err(|_| "plugin operation stopped before completion".to_string())?
    }

    pub fn inspect_plugin(&self, operand: String) -> Result<PluginInspection, String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.command_tx
            .send(RuntimeCommand::InspectPlugin(operand, reply_tx))
            .map_err(|_| "runtime supervisor is not running".to_string())?;
        reply_rx
            .recv()
            .map_err(|_| "plugin inspection stopped before completion".to_string())?
    }

    pub fn shutdown_blocking(&self) -> Result<(), String> {
        if self.shutdown_confirmed.load(Ordering::Acquire) {
            return Ok(());
        }
        self.shutdown_blocking_with_timeout(STOP_TIMEOUT + Duration::from_secs(3))
    }

    fn shutdown_blocking_with_timeout(&self, timeout: Duration) -> Result<(), String> {
        let (accepted_tx, accepted_rx) = mpsc::sync_channel(0);
        let (ack_tx, ack_rx) = mpsc::channel();
        self.command_tx
            .send(RuntimeCommand::Shutdown(accepted_tx, ack_tx))
            .map_err(|_| "runtime supervisor is not running".to_string())?;
        accepted_rx
            .recv_timeout(timeout)
            .map_err(|error| match error {
                RecvTimeoutError::Timeout => {
                    "runtime supervisor did not accept shutdown before the deadline".to_string()
                }
                RecvTimeoutError::Disconnected => {
                    "runtime supervisor stopped without accepting shutdown".to_string()
                }
            })?;
        ack_rx
            .recv_timeout(STOP_TIMEOUT + Duration::from_secs(3))
            .map_err(|error| match error {
                RecvTimeoutError::Timeout => {
                    "runtime supervisor did not finish an accepted shutdown before the deadline"
                        .to_string()
                }
                RecvTimeoutError::Disconnected => {
                    "runtime supervisor stopped without confirming shutdown".to_string()
                }
            })?
    }

    fn invalidate_shutdown_confirmation(&self) {
        self.shutdown_confirmed.store(false, Ordering::Release);
    }

    fn update(&self, app: &tauri::AppHandle, status: RuntimeStatus) {
        *self.status.lock().expect("runtime status mutex poisoned") = status.clone();
        let _ = app.emit("runtime-status", status);
    }
}

pub(crate) struct RuntimeFailure {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

enum RuntimeOutput {
    Stdout(String),
    Stderr(String),
}

struct RunningRuntime {
    child: ProcessTree,
    url: String,
}

pub fn spawn_worker(
    app: tauri::AppHandle,
    handle: RuntimeHandle,
    command_rx: Receiver<RuntimeCommand>,
) {
    thread::spawn(move || {
        let mut running = start_and_publish(&app, &handle);

        loop {
            match command_rx.recv_timeout(Duration::from_millis(250)) {
                Ok(RuntimeCommand::Restart) => {
                    if let Err(error) = stop_running(&app, &handle, &mut running) {
                        publish_shutdown_failed(&app, &handle, error);
                        continue;
                    }
                    let _ = restore_bootstrap(&app, handle.clone());
                    running = start_and_publish(&app, &handle);
                }
                Ok(RuntimeCommand::Plugin(request, reply)) => {
                    let should_restart = request.is_mutating();
                    if should_restart && let Err(error) = stop_running(&app, &handle, &mut running)
                    {
                        publish_shutdown_failed(&app, &handle, error.clone());
                        let _ = reply.send(Err(error));
                        continue;
                    }
                    if should_restart {
                        let _ = restore_bootstrap(&app, handle.clone());
                    }
                    let result = resolve_runtime(&app)
                        .map_err(|error| error.message)
                        .and_then(|(node, entry)| {
                            execute_plugin_command(&app, &request, &node, &entry)
                        });
                    if should_restart_after_plugin(should_restart, &result) {
                        running = start_and_publish(&app, &handle);
                    } else if should_restart {
                        publish_unrecoverable_profile(&app, &handle, &result);
                    }
                    let _ = reply.send(result);
                }
                Ok(RuntimeCommand::InspectPlugin(operand, reply)) => {
                    let result = resolve_runtime(&app)
                        .map_err(|error| error.message)
                        .and_then(|(node, entry)| {
                            inspect_plugin_source(&app, &operand, &node, &entry)
                        });
                    let _ = reply.send(result);
                }
                Ok(RuntimeCommand::Shutdown(accepted, ack)) => {
                    if accepted.send(()).is_err() {
                        let _ = ack.send(Err(
                            "shutdown request expired before the supervisor accepted it"
                                .to_string(),
                        ));
                        continue;
                    }
                    let result = stop_running(&app, &handle, &mut running);
                    if let Err(error) = &result {
                        publish_shutdown_failed(&app, &handle, error.clone());
                        let _ = ack.send(result);
                        continue;
                    }
                    handle.shutdown_confirmed.store(true, Ordering::Release);
                    handle.update(&app, RuntimeStatus::default());
                    let _ = ack.send(result);
                }
                Err(RecvTimeoutError::Disconnected) => {
                    if let Some(mut process) = running.take()
                        && let Err(error) = stop_process_tree_until_dead(&mut process.child)
                    {
                        eprintln!("failed to stop runtime process tree: {error}");
                    }
                    break;
                }
                Err(RecvTimeoutError::Timeout) => {}
            }

            if let Some(process) = running.as_mut() {
                match process.child.try_wait() {
                    Ok(Some(exit)) => {
                        let mut message = format!("DeepSeek Harness 意外退出（{exit}）。");
                        if let Err(stop_error) = stop_process_tree_until_dead(&mut process.child) {
                            message.push_str(&format!(
                                "其残留子进程未能完全终止，可能需要手动清理：{stop_error}。"
                            ));
                            handle.update(
                                &app,
                                RuntimeStatus {
                                    phase: RuntimePhase::Failed,
                                    url: None,
                                    error_code: Some("runtime-exited".to_string()),
                                    message: Some(message),
                                },
                            );
                            let _ = restore_bootstrap(&app, handle.clone());
                        } else {
                            running = None;
                            handle.update(
                                &app,
                                RuntimeStatus {
                                    phase: RuntimePhase::Failed,
                                    url: None,
                                    error_code: Some("runtime-exited".to_string()),
                                    message: Some(message),
                                },
                            );
                            let _ = restore_bootstrap(&app, handle.clone());
                        }
                    }
                    Ok(None) => {}
                    Err(error) => {
                        handle.update(
                            &app,
                            RuntimeStatus {
                                phase: RuntimePhase::Failed,
                                url: None,
                                error_code: Some("runtime-monitor-failed".to_string()),
                                message: Some(error.to_string()),
                            },
                        );
                        let _ = restore_bootstrap(&app, handle.clone());
                    }
                }
            }
        }
    });
}

fn start_and_publish(app: &tauri::AppHandle, handle: &RuntimeHandle) -> Option<RunningRuntime> {
    handle.invalidate_shutdown_confirmation();
    handle.update(
        app,
        RuntimeStatus {
            phase: RuntimePhase::Starting,
            url: None,
            error_code: None,
            message: Some("正在验证并启动本地运行环境…".to_string()),
        },
    );

    match start_runtime(app) {
        Ok(mut process) => {
            handle.update(
                app,
                RuntimeStatus {
                    phase: RuntimePhase::Ready,
                    url: Some(process.url.clone()),
                    error_code: None,
                    message: None,
                },
            );
            if let Err(message) = navigate_to_runtime(app, &process.url) {
                let message = match stop_process_tree_until_dead(&mut process.child) {
                    Ok(()) => message,
                    Err(stop_error) => format!("{message} 残留进程未能完全终止：{stop_error}"),
                };
                handle.update(
                    app,
                    RuntimeStatus {
                        phase: RuntimePhase::Failed,
                        url: None,
                        error_code: Some("desktop-navigation-failed".to_string()),
                        message: Some(message),
                    },
                );
                return None;
            }
            Some(process)
        }
        Err(error) => {
            handle.update(
                app,
                RuntimeStatus {
                    phase: RuntimePhase::Failed,
                    url: None,
                    error_code: Some(error.code.to_string()),
                    message: Some(error.message),
                },
            );
            None
        }
    }
}

fn publish_stopping(app: &tauri::AppHandle, handle: &RuntimeHandle) {
    handle.update(
        app,
        RuntimeStatus {
            phase: RuntimePhase::Stopping,
            url: handle.status().url,
            error_code: None,
            message: None,
        },
    );
}

fn should_restart_after_plugin(
    mutating: bool,
    result: &Result<PluginCommandResult, String>,
) -> bool {
    if !mutating {
        return false;
    }
    !matches!(
        result,
        Ok(outcome) if outcome.profile_unrecoverable
    )
}

fn publish_unrecoverable_profile(
    app: &tauri::AppHandle,
    handle: &RuntimeHandle,
    result: &Result<PluginCommandResult, String>,
) {
    let message = match result {
        Ok(outcome) if !outcome.stderr.trim().is_empty() => outcome.stderr.clone(),
        Ok(_) => "插件 Profile 无法恢复，已停止 Harness。".to_string(),
        Err(error) => error.clone(),
    };
    handle.update(
        app,
        RuntimeStatus {
            phase: RuntimePhase::Failed,
            url: None,
            error_code: Some("runtime-profile-unrecoverable".to_string()),
            message: Some(message),
        },
    );
}

fn publish_shutdown_failed(app: &tauri::AppHandle, handle: &RuntimeHandle, error: String) {
    handle.update(
        app,
        RuntimeStatus {
            phase: RuntimePhase::Failed,
            url: handle.status().url,
            error_code: Some("runtime-shutdown-failed".to_string()),
            message: Some(error),
        },
    );
}

fn stop_running(
    app: &tauri::AppHandle,
    handle: &RuntimeHandle,
    running: &mut Option<RunningRuntime>,
) -> Result<(), String> {
    let Some(mut process) = running.take() else {
        return Ok(());
    };
    publish_stopping(app, handle);
    match stop_process_tree(&mut process.child, STOP_TIMEOUT) {
        Ok(()) => Ok(()),
        Err(error) => {
            *running = Some(process);
            Err(error)
        }
    }
}

fn start_runtime(app: &tauri::AppHandle) -> Result<RunningRuntime, RuntimeFailure> {
    let (node, entry) = resolve_runtime(app)?;
    let dsh_home = app
        .path()
        .app_data_dir()
        .map_err(|error| failure("runtime-path-failed", error))?
        .join("harness");
    crate::secure_fs::ensure_private_dir(&dsh_home)
        .map_err(|error| failure("runtime-path-failed", error))?;

    let log_dir = diagnostic_dir(app)?;
    crate::secure_fs::ensure_private_dir(&log_dir)
        .map_err(|error| failure("runtime-log-failed", error))?;
    let log_path = log_dir.join("runtime.log");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| failure("runtime-log-failed", error))?;
    crate::secure_fs::restrict_file_permissions(&log_path)
        .map_err(|error| failure("runtime-log-failed", error))?;
    let log = Arc::new(Mutex::new(log));

    let workspace = crate::secure_fs::resolve_workspace(
        std::env::var_os("DSH_DESKTOP_WORKSPACE").map(PathBuf::from),
        app.path()
            .app_data_dir()
            .map_err(|error| failure("runtime-workspace-failed", error))?
            .join("workspace"),
    )
    .map_err(|message| RuntimeFailure {
        code: "runtime-workspace-failed",
        message,
    })?;

    write_log(
        &log,
        "desktop",
        &format!("starting runtime in {}", workspace.display()),
    );

    let mut command = harness_command(&node, &entry);
    command
        .args(["web", "--host", "127.0.0.1", "--port", "0"])
        .current_dir(workspace)
        .env("DSH_HOME", dsh_home)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    configure_process_tree_command(&mut command);

    let mut child = command.spawn().map_err(|error| RuntimeFailure {
        code: "runtime-spawn-failed",
        message: format!("无法启动内置 DeepSeek Harness：{error}"),
    })?;

    let stdout = child.stdout.take().expect("piped stdout missing");
    let stderr = child.stderr.take().expect("piped stderr missing");
    let (output_tx, output_rx) = mpsc::channel();
    spawn_output_reader(
        stdout,
        RuntimeStream::Stdout,
        output_tx.clone(),
        log.clone(),
    );
    spawn_output_reader(stderr, RuntimeStream::Stderr, output_tx, log);
    let mut child = ProcessTree::attach(child).map_err(|message| RuntimeFailure {
        code: "runtime-process-tree-failed",
        message,
    })?;

    let started = Instant::now();
    while started.elapsed() < START_TIMEOUT {
        if let Some(exit) = child
            .try_wait()
            .map_err(|error| failure("runtime-monitor-failed", error))?
        {
            return Err(RuntimeFailure {
                code: "runtime-exited",
                message: format!("DeepSeek Harness 在启动完成前退出（{exit}）。"),
            });
        }

        match output_rx.recv_timeout(Duration::from_millis(250)) {
            Ok(RuntimeOutput::Stdout(line)) => {
                if let Some(url) = parse_ready_url(&line) {
                    if let Err(error) = wait_for_health(&url) {
                        if let Err(stop_error) = stop_process_tree_until_dead(&mut child) {
                            return Err(RuntimeFailure {
                                code: error.code,
                                message: format!(
                                    "{} 残留进程未能完全终止：{stop_error}",
                                    error.message
                                ),
                            });
                        }
                        return Err(error);
                    }
                    return Ok(RunningRuntime { child, url });
                }
            }
            Ok(RuntimeOutput::Stderr(_line)) => {}
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    let timeout = RuntimeFailure {
        code: "runtime-timeout",
        message: "DeepSeek Harness 未在 20 秒内完成启动。".to_string(),
    };
    if let Err(stop_error) = stop_process_tree_until_dead(&mut child) {
        return Err(RuntimeFailure {
            code: timeout.code,
            message: format!("{} 残留进程未能完全终止：{stop_error}", timeout.message),
        });
    }
    Err(timeout)
}

fn parse_ready_url(line: &str) -> Option<String> {
    let value = line.strip_prefix("dsh web: ")?.split_whitespace().next()?;
    let url = Url::parse(value).ok()?;
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || url.port().is_none() {
        return None;
    }
    Some(url.to_string())
}

fn wait_for_health(value: &str) -> Result<(), RuntimeFailure> {
    let url = Url::parse(value).map_err(|error| failure("runtime-invalid-url", error))?;
    let port = url.port().ok_or_else(|| RuntimeFailure {
        code: "runtime-invalid-url",
        message: "Harness 没有报告有效端口。".to_string(),
    })?;
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + HEALTH_TIMEOUT;

    while Instant::now() < deadline {
        if let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
            let request =
                format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
            if stream.write_all(request.as_bytes()).is_ok() {
                let mut response = [0_u8; 64];
                if let Ok(size) = stream.read(&mut response)
                    && size > 0
                    && response[..size].starts_with(b"HTTP/1.1 200")
                {
                    return Ok(());
                }
            }
        }
        thread::sleep(Duration::from_millis(120));
    }

    Err(RuntimeFailure {
        code: "runtime-health-failed",
        message: "DeepSeek Harness 已监听端口，但健康检查未通过。".to_string(),
    })
}

enum RuntimeStream {
    Stdout,
    Stderr,
}

fn spawn_output_reader(
    reader: impl Read + Send + 'static,
    stream: RuntimeStream,
    tx: Sender<RuntimeOutput>,
    log: Arc<Mutex<File>>,
) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            let label = match stream {
                RuntimeStream::Stdout => "stdout",
                RuntimeStream::Stderr => "stderr",
            };
            write_log(&log, label, &line);
            let message = match stream {
                RuntimeStream::Stdout => RuntimeOutput::Stdout(line),
                RuntimeStream::Stderr => RuntimeOutput::Stderr(line),
            };
            if tx.send(message).is_err() {
                break;
            }
        }
    });
}

fn write_log(log: &Arc<Mutex<File>>, stream: &str, line: &str) {
    if let Ok(mut file) = log.lock() {
        let _ = writeln!(
            file,
            "[{stream}] {}",
            crate::log_redact::redact_log_line(line)
        );
    }
}

pub fn diagnostic_dir(app: &tauri::AppHandle) -> Result<PathBuf, RuntimeFailure> {
    app.path()
        .app_log_dir()
        .or_else(|_| app.path().app_data_dir().map(|path| path.join("logs")))
        .map_err(|error| failure("runtime-log-failed", error))
}

fn stop_retries_exhausted(elapsed: Duration, window: Duration) -> bool {
    elapsed >= window
}

fn stop_process_tree_until_dead(process: &mut ProcessTree) -> Result<(), String> {
    let started = Instant::now();
    loop {
        match stop_process_tree(process, STOP_TIMEOUT) {
            Ok(()) => return Ok(()),
            Err(error) if stop_retries_exhausted(started.elapsed(), FORCE_STOP_WINDOW) => {
                return Err(error);
            }
            Err(error) => eprintln!("failed to stop runtime process tree; retrying: {error}"),
        }
        thread::sleep(Duration::from_millis(250));
    }
}

fn failure(code: &'static str, error: impl std::fmt::Display) -> RuntimeFailure {
    RuntimeFailure {
        code,
        message: error.to_string(),
    }
}

#[cfg(test)]
#[path = "runtime_supervisor_tests.rs"]
mod tests;
