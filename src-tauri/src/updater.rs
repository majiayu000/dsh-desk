use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    process,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, menu::MenuItemKind};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::runtime_supervisor::RuntimeHandle;

const UPDATE_EVENT: &str = "update-status";
const APPLICATION_MENU_ID: &str = "application-menu";
const UPDATE_MENU_ID: &str = "software-update";
const PREFERENCES_FILE: &str = "update-preferences.json";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdatePhase {
    #[default]
    Idle,
    Checking,
    UpToDate,
    Available,
    Downloading,
    Ready,
    Installing,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    phase: UpdatePhase,
    current_version: String,
    available_version: Option<String>,
    notes: Option<String>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    checked_at: Option<u64>,
    auto_download: bool,
    download_ready: bool,
    error: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum InstallAfterShutdownError {
    Shutdown(String),
    Install(String),
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePreferences {
    auto_download: bool,
}

struct UpdateSession {
    phase: UpdatePhase,
    available_version: Option<String>,
    notes: Option<String>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    last_reported_bytes: u64,
    last_reported_percent: u8,
    checked_at: Option<u64>,
    auto_download: bool,
    error: Option<String>,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

impl Default for UpdateSession {
    fn default() -> Self {
        Self {
            phase: UpdatePhase::Idle,
            available_version: None,
            notes: None,
            downloaded_bytes: 0,
            total_bytes: None,
            last_reported_bytes: 0,
            last_reported_percent: 0,
            checked_at: None,
            auto_download: true,
            error: None,
            update: None,
            bytes: None,
        }
    }
}

#[derive(Default)]
pub struct UpdateCoordinator {
    session: Mutex<UpdateSession>,
}

impl UpdateCoordinator {
    fn is_idle(&self) -> bool {
        self.session
            .lock()
            .map(|session| session.phase == UpdatePhase::Idle)
            .unwrap_or(false)
    }

    fn snapshot(&self, app: &AppHandle) -> Result<UpdateStatus, String> {
        let session = self
            .session
            .lock()
            .map_err(|_| "更新状态暂时不可用，请重新打开更新窗口。".to_string())?;
        Ok(UpdateStatus {
            phase: session.phase,
            current_version: app.package_info().version.to_string(),
            available_version: session.available_version.clone(),
            notes: session.notes.clone(),
            downloaded_bytes: session.downloaded_bytes,
            total_bytes: session.total_bytes,
            checked_at: session.checked_at,
            auto_download: session.auto_download,
            download_ready: session.bytes.is_some(),
            error: session.error.clone(),
        })
    }

    fn begin_check(&self) -> Result<bool, String> {
        let mut session = self
            .session
            .lock()
            .map_err(|_| "无法开始更新检查。".to_string())?;
        if matches!(
            session.phase,
            UpdatePhase::Checking | UpdatePhase::Downloading | UpdatePhase::Installing
        ) {
            return Ok(false);
        }

        session.phase = UpdatePhase::Checking;
        session.error = None;
        session.downloaded_bytes = 0;
        session.total_bytes = None;
        session.last_reported_bytes = 0;
        session.last_reported_percent = 0;
        session.bytes = None;
        Ok(true)
    }

    fn finish_check(&self, update: Option<Update>) -> Result<bool, String> {
        let mut session = self
            .session
            .lock()
            .map_err(|_| "无法保存更新检查结果。".to_string())?;
        if session.phase != UpdatePhase::Checking {
            return Ok(false);
        }
        session.checked_at = Some(now_millis());
        session.error = None;

        if let Some(update) = update {
            session.phase = UpdatePhase::Available;
            session.available_version = Some(update.version.clone());
            session.notes = update
                .body
                .clone()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| Some("此版本未提供更新说明。".to_string()));
            session.update = Some(update);
            Ok(session.auto_download)
        } else {
            session.phase = UpdatePhase::UpToDate;
            session.available_version = None;
            session.notes = None;
            session.update = None;
            Ok(false)
        }
    }

    fn begin_download(&self) -> Result<Option<Update>, String> {
        let mut session = self
            .session
            .lock()
            .map_err(|_| "无法开始下载更新。".to_string())?;
        if !download_allowed(
            session.phase,
            session.update.is_some(),
            session.bytes.is_some(),
        ) {
            return Ok(None);
        }
        let Some(update) = session.update.clone() else {
            return Err("更新信息已过期，请重新检查。".to_string());
        };
        session.phase = UpdatePhase::Downloading;
        session.error = None;
        session.downloaded_bytes = 0;
        session.total_bytes = None;
        session.last_reported_bytes = 0;
        session.last_reported_percent = 0;
        session.bytes = None;
        Ok(Some(update))
    }

    fn record_download(&self, chunk: usize, total: Option<u64>) -> bool {
        if let Ok(mut session) = self.session.lock() {
            if session.phase != UpdatePhase::Downloading {
                return false;
            }
            session.downloaded_bytes = session.downloaded_bytes.saturating_add(chunk as u64);
            if total.is_some() {
                session.total_bytes = total;
            }
            let percent = session.total_bytes.filter(|total| *total > 0).map(|total| {
                ((session.downloaded_bytes.saturating_mul(100) / total).min(100)) as u8
            });
            let should_report = percent
                .map(|value| value != session.last_reported_percent)
                .unwrap_or_else(|| {
                    session
                        .downloaded_bytes
                        .saturating_sub(session.last_reported_bytes)
                        >= 512 * 1024
                });
            if should_report {
                session.last_reported_bytes = session.downloaded_bytes;
                session.last_reported_percent = percent.unwrap_or(session.last_reported_percent);
            }
            return should_report;
        }
        false
    }

    fn finish_download(&self, bytes: Vec<u8>) -> Result<(), String> {
        let mut session = self
            .session
            .lock()
            .map_err(|_| "无法保存已验证的更新包。".to_string())?;
        if session.phase != UpdatePhase::Downloading {
            return Ok(());
        }
        session.downloaded_bytes = bytes.len() as u64;
        session.total_bytes = Some(bytes.len() as u64);
        session.bytes = Some(bytes);
        session.phase = UpdatePhase::Ready;
        session.error = None;
        Ok(())
    }

    fn begin_install(&self) -> Result<Option<(Update, Vec<u8>)>, String> {
        let mut session = self
            .session
            .lock()
            .map_err(|_| "无法开始安装更新。".to_string())?;
        if !install_allowed(
            session.phase,
            session.update.is_some(),
            session.bytes.is_some(),
        ) {
            return Ok(None);
        }
        let update = session
            .update
            .clone()
            .ok_or_else(|| "更新信息已过期，请重新检查。".to_string())?;
        let bytes = session
            .bytes
            .take()
            .ok_or_else(|| "更新包尚未下载完成。".to_string())?;
        session.phase = UpdatePhase::Installing;
        session.error = None;
        Ok(Some((update, bytes)))
    }

    fn restore_download(&self, bytes: Vec<u8>, error: String) {
        if let Ok(mut session) = self.session.lock() {
            session.bytes = Some(bytes);
            session.phase = UpdatePhase::Error;
            session.error = Some(error);
        }
    }

    fn fail(&self, error: String) {
        if let Ok(mut session) = self.session.lock() {
            session.phase = UpdatePhase::Error;
            session.error = Some(error);
        }
    }

    fn set_auto_download(&self, enabled: bool) -> Result<bool, String> {
        let mut session = self
            .session
            .lock()
            .map_err(|_| "无法保存自动下载设置。".to_string())?;
        session.auto_download = enabled;
        Ok(enabled && session.phase == UpdatePhase::Available)
    }

    fn load_auto_download(&self, enabled: bool) {
        if let Ok(mut session) = self.session.lock() {
            session.auto_download = enabled;
        }
    }

    fn is_installing(&self) -> bool {
        self.session
            .lock()
            .map(|session| session.phase == UpdatePhase::Installing)
            .unwrap_or(true)
    }
}

fn download_allowed(phase: UpdatePhase, has_update: bool, has_bytes: bool) -> bool {
    has_update
        && matches!(phase, UpdatePhase::Available | UpdatePhase::Error)
        && !(phase == UpdatePhase::Error && has_bytes)
}

fn install_allowed(phase: UpdatePhase, has_update: bool, has_bytes: bool) -> bool {
    has_update && has_bytes && matches!(phase, UpdatePhase::Ready | UpdatePhase::Error)
}

pub fn initialize(app: &AppHandle) {
    let auto_download = match load_preferences(app) {
        Ok(preferences) => preferences.auto_download,
        Err(error) => {
            eprintln!("ignoring invalid update preferences and disabling auto-download: {error}");
            false
        }
    };
    app.state::<UpdateCoordinator>()
        .load_auto_download(auto_download);
}

pub fn status(app: &AppHandle) -> Result<UpdateStatus, String> {
    app.state::<UpdateCoordinator>().snapshot(app)
}

pub fn is_installing(app: &AppHandle) -> bool {
    app.state::<UpdateCoordinator>().is_installing()
}

pub fn request_check(app: AppHandle) {
    let coordinator = app.state::<UpdateCoordinator>();
    match coordinator.begin_check() {
        Ok(true) => publish(&app, true),
        Ok(false) => return,
        Err(error) => {
            coordinator.fail(error);
            publish(&app, true);
            return;
        }
    }

    tauri::async_runtime::spawn(async move {
        let result = async {
            let update = app
                .updater()
                .map_err(|error| format!("无法初始化更新器：{error}"))?
                .check()
                .await
                .map_err(|error| format!("无法获取更新信息：{error}"))?;
            app.state::<UpdateCoordinator>().finish_check(update)
        }
        .await;

        match result {
            Ok(auto_download) => {
                publish(&app, true);
                if auto_download {
                    request_download(app.clone());
                }
            }
            Err(error) => {
                app.state::<UpdateCoordinator>().fail(error);
                publish(&app, true);
            }
        }
    });
}

pub fn request_check_if_idle(app: AppHandle) {
    if app.state::<UpdateCoordinator>().is_idle() {
        request_check(app);
    }
}

pub fn request_download(app: AppHandle) {
    let update = match app.state::<UpdateCoordinator>().begin_download() {
        Ok(Some(update)) => update,
        Ok(None) => return,
        Err(error) => {
            app.state::<UpdateCoordinator>().fail(error);
            publish(&app, true);
            return;
        }
    };
    publish(&app, true);

    tauri::async_runtime::spawn(async move {
        let progress_app = app.clone();
        let result = update
            .download(
                move |chunk, total| {
                    let should_publish = progress_app
                        .state::<UpdateCoordinator>()
                        .record_download(chunk, total);
                    if should_publish {
                        publish(&progress_app, false);
                    }
                },
                || {},
            )
            .await
            .map_err(|error| format!("更新包下载或签名校验失败：{error}"));

        match result {
            Ok(bytes) => {
                if let Err(error) = app.state::<UpdateCoordinator>().finish_download(bytes) {
                    app.state::<UpdateCoordinator>().fail(error);
                }
            }
            Err(error) => app.state::<UpdateCoordinator>().fail(error),
        }
        publish(&app, true);
    });
}

pub fn request_install(app: AppHandle) {
    let Some((update, bytes)) = (match app.state::<UpdateCoordinator>().begin_install() {
        Ok(value) => value,
        Err(error) => {
            app.state::<UpdateCoordinator>().fail(error);
            publish(&app, true);
            return;
        }
    }) else {
        return;
    };
    publish(&app, true);

    tauri::async_runtime::spawn(async move {
        let runtime = app.state::<RuntimeHandle>().inner().clone();
        let shutdown = tauri::async_runtime::spawn_blocking(move || runtime.shutdown_blocking())
            .await
            .map_err(|error| format!("停止 DeepSeek Harness 时发生内部错误：{error}"))
            .and_then(|result| result);

        match install_after_shutdown(shutdown, || {
            update.install(&bytes).map_err(|error| error.to_string())
        }) {
            Ok(()) => app.restart(),
            Err(InstallAfterShutdownError::Shutdown(error)) => {
                app.state::<UpdateCoordinator>()
                    .restore_download(bytes, format!("无法安全停止 DeepSeek Harness：{error}"));
                publish(&app, true);
            }
            Err(InstallAfterShutdownError::Install(error)) => {
                app.state::<UpdateCoordinator>()
                    .restore_download(bytes, format!("安装更新时发生错误：{error}"));
                publish(&app, true);
            }
        }
    });
}

pub fn set_auto_download(app: &AppHandle, enabled: bool) -> Result<UpdateStatus, String> {
    save_preferences(
        app,
        UpdatePreferences {
            auto_download: enabled,
        },
    )?;
    let should_download = app
        .state::<UpdateCoordinator>()
        .set_auto_download(enabled)?;
    publish(app, false);
    if should_download {
        request_download(app.clone());
    }
    status(app)
}

fn publish(app: &AppHandle, update_menu: bool) {
    let Ok(status) = status(app) else {
        return;
    };
    let _ = app.emit(UPDATE_EVENT, status.clone());
    if update_menu {
        set_menu_label(app, &status);
    }
}

fn set_menu_label(app: &AppHandle, status: &UpdateStatus) {
    let text = match (&status.phase, status.available_version.as_deref()) {
        (UpdatePhase::Available, Some(version)) => format!("下载 DSH Desk {version}…"),
        (UpdatePhase::Downloading, Some(version)) => format!("正在下载 DSH Desk {version}…"),
        (UpdatePhase::Ready, Some(version)) => format!("重启以安装 DSH Desk {version}…"),
        _ => "软件更新…".to_string(),
    };
    if let Some(MenuItemKind::Submenu(application)) =
        app.menu().and_then(|menu| menu.get(APPLICATION_MENU_ID))
    {
        if let Some(MenuItemKind::MenuItem(item)) = application.get(UPDATE_MENU_ID) {
            if let Err(error) = item.set_text(text) {
                eprintln!("failed to update the software update menu label: {error}");
            }
        }
    }
}

fn preferences_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(PREFERENCES_FILE))
        .map_err(|error| format!("无法定位更新设置目录：{error}"))
}

fn load_preferences(app: &AppHandle) -> Result<UpdatePreferences, String> {
    let path = preferences_path(app)?;
    if !path.exists() {
        return Ok(UpdatePreferences {
            auto_download: true,
        });
    }
    let contents =
        fs::read_to_string(path).map_err(|error| format!("无法读取更新设置：{error}"))?;
    serde_json::from_str(&contents).map_err(|error| format!("无法解析更新设置：{error}"))
}

fn save_preferences(app: &AppHandle, preferences: UpdatePreferences) -> Result<(), String> {
    let path = preferences_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "更新设置路径无效。".to_string())?;
    fs::create_dir_all(directory).map_err(|error| format!("无法创建更新设置目录：{error}"))?;
    let contents = serde_json::to_vec_pretty(&preferences)
        .map_err(|error| format!("无法序列化更新设置：{error}"))?;
    atomic_write(&path, &contents).map_err(|error| format!("无法保存更新设置：{error}"))
}

fn atomic_write(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let temporary = path.with_extension(format!("tmp-{}-{}", process::id(), now_millis()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        replace_file(&temporary, path)
    })();
    if result.is_err() {
        if let Err(error) = fs::remove_file(&temporary)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            eprintln!("failed to remove temporary update preferences file: {error}");
        }
    }
    result
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::{iter::once, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn install_after_shutdown(
    shutdown: Result<(), String>,
    install: impl FnOnce() -> Result<(), String>,
) -> Result<(), InstallAfterShutdownError> {
    shutdown.map_err(InstallAfterShutdownError::Shutdown)?;
    install().map_err(InstallAfterShutdownError::Install)
}

#[cfg(test)]
mod tests {
    use std::{cell::Cell, fs};

    use super::{
        InstallAfterShutdownError, UpdateCoordinator, UpdatePhase, atomic_write, download_allowed,
        install_after_shutdown, install_allowed, now_millis,
    };

    #[test]
    fn coordinator_allows_only_one_busy_operation() {
        let coordinator = UpdateCoordinator::default();

        assert!(coordinator.begin_check().expect("first check should start"));
        assert!(
            !coordinator
                .begin_check()
                .expect("second check should be ignored")
        );
    }

    #[test]
    fn disabling_auto_download_is_reflected_in_state() {
        let coordinator = UpdateCoordinator::default();
        assert!(
            !coordinator
                .set_auto_download(false)
                .expect("preference should update")
        );
        assert!(
            !coordinator
                .session
                .lock()
                .expect("session lock")
                .auto_download
        );
        assert_eq!(
            coordinator.session.lock().expect("session lock").phase,
            UpdatePhase::Idle
        );
    }

    #[test]
    fn download_transition_rejects_conflicting_and_stale_phases() {
        for phase in [
            UpdatePhase::Idle,
            UpdatePhase::Checking,
            UpdatePhase::UpToDate,
            UpdatePhase::Downloading,
            UpdatePhase::Ready,
            UpdatePhase::Installing,
        ] {
            assert!(!download_allowed(phase, true, false), "phase: {phase:?}");
        }
        assert!(download_allowed(UpdatePhase::Available, true, false));
        assert!(download_allowed(UpdatePhase::Error, true, false));
        assert!(!download_allowed(UpdatePhase::Error, true, true));
        assert!(!download_allowed(UpdatePhase::Available, false, false));
    }

    #[test]
    fn install_transition_requires_retained_update_and_bytes() {
        assert!(install_allowed(UpdatePhase::Ready, true, true));
        assert!(install_allowed(UpdatePhase::Error, true, true));
        assert!(!install_allowed(UpdatePhase::Checking, true, true));
        assert!(!install_allowed(UpdatePhase::Installing, true, true));
        assert!(!install_allowed(UpdatePhase::Ready, false, true));
        assert!(!install_allowed(UpdatePhase::Ready, true, false));
    }

    #[test]
    fn install_failure_keeps_verified_bytes_for_retry() {
        let coordinator = UpdateCoordinator::default();
        coordinator.restore_download(vec![1, 2, 3], "installer failed".to_string());
        let Ok(session) = coordinator.session.lock() else {
            panic!("session lock poisoned");
        };

        assert_eq!(session.phase, UpdatePhase::Error);
        assert_eq!(session.bytes.as_deref(), Some([1, 2, 3].as_slice()));
        assert_eq!(session.error.as_deref(), Some("installer failed"));
    }

    #[test]
    fn atomic_preferences_write_replaces_an_existing_file() {
        let directory = std::env::temp_dir().join(format!(
            "dsh-desk-updater-test-{}-{}",
            std::process::id(),
            now_millis()
        ));
        assert!(fs::create_dir(&directory).is_ok());
        let path = directory.join("preferences.json");

        assert!(atomic_write(&path, br#"{"autoDownload":true}"#).is_ok());
        assert!(atomic_write(&path, br#"{"autoDownload":false}"#).is_ok());
        assert_eq!(
            fs::read(&path).ok().as_deref(),
            Some(br#"{"autoDownload":false}"#.as_slice())
        );
        assert!(fs::remove_dir_all(&directory).is_ok());
    }

    #[test]
    fn shutdown_rejection_prevents_installation() {
        let installed = Cell::new(false);

        let result = install_after_shutdown(Err("still running".to_string()), || {
            installed.set(true);
            Ok(())
        });

        assert_eq!(
            result,
            Err(InstallAfterShutdownError::Shutdown(
                "still running".to_string()
            ))
        );
        assert!(!installed.get());
    }

    #[test]
    fn install_runs_only_after_confirmed_shutdown() {
        let installed = Cell::new(false);

        let result = install_after_shutdown(Ok(()), || {
            installed.set(true);
            Err("installer failed".to_string())
        });

        assert_eq!(
            result,
            Err(InstallAfterShutdownError::Install(
                "installer failed".to_string()
            ))
        );
        assert!(installed.get());
    }
}
