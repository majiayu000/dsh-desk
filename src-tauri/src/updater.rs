use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

use crate::runtime_supervisor::RuntimeHandle;

#[derive(Default)]
pub struct UpdateCoordinator {
    checking: AtomicBool,
}

impl UpdateCoordinator {
    fn begin(&self) -> bool {
        !self.checking.swap(true, Ordering::AcqRel)
    }

    fn finish(&self) {
        self.checking.store(false, Ordering::Release);
    }
}

pub fn request_check(app: AppHandle, interactive: bool) {
    if !app.state::<UpdateCoordinator>().begin() {
        if interactive {
            show_info(&app, "正在检查更新", "另一个更新检查正在进行中。");
        }
        return;
    }

    tauri::async_runtime::spawn(async move {
        let result = check_and_maybe_install(&app, interactive).await;
        app.state::<UpdateCoordinator>().finish();

        if let Err(error) = result {
            if interactive {
                show_error(&app, "更新失败", &error);
            } else {
                eprintln!("automatic update check failed: {error}");
            }
        }
    });
}

async fn check_and_maybe_install(app: &AppHandle, interactive: bool) -> Result<(), String> {
    let Some(update) = app
        .updater()
        .map_err(|error| format!("无法初始化更新器：{error}"))?
        .check()
        .await
        .map_err(|error| format!("无法获取更新信息：{error}"))?
    else {
        if interactive {
            show_info(
                app,
                "已是最新版本",
                &format!("当前版本 {} 已是最新版本。", app.package_info().version),
            );
        }
        return Ok(());
    };

    let notes = update
        .body
        .as_deref()
        .filter(|notes| !notes.trim().is_empty())
        .unwrap_or("此版本未提供更新说明。");
    let message = format!(
        "发现 DSH Desk {}（当前为 {}）。\n\n{}\n\n现在下载并安装吗？",
        update.version, update.current_version, notes
    );
    let accepted = app
        .dialog()
        .message(message)
        .title("发现新版本")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "更新并重启".to_string(),
            "稍后".to_string(),
        ))
        .blocking_show();
    if !accepted {
        return Ok(());
    }

    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| format!("更新包下载或签名校验失败：{error}"))?;

    let runtime = app.state::<RuntimeHandle>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.shutdown_blocking())
        .await
        .map_err(|error| format!("停止 DeepSeek Harness 时发生内部错误：{error}"))?
        .map_err(|error| format!("无法安全停止 DeepSeek Harness：{error}"))?;

    if let Err(error) = update.install(bytes) {
        show_error(
            app,
            "安装更新失败",
            &format!("安装更新时发生错误：{error}\n\n应用将重新启动当前版本。"),
        );
        app.restart();
    }

    app.restart();
}

fn show_info(app: &AppHandle, title: &str, message: &str) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Info)
        .blocking_show();
}

fn show_error(app: &AppHandle, title: &str, message: &str) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .blocking_show();
}

#[cfg(test)]
mod tests {
    use super::UpdateCoordinator;

    #[test]
    fn coordinator_allows_only_one_check_at_a_time() {
        let coordinator = UpdateCoordinator::default();

        assert!(coordinator.begin());
        assert!(!coordinator.begin());

        coordinator.finish();
        assert!(coordinator.begin());
    }
}
