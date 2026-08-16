use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

use crate::{runtime_supervisor::RuntimeHandle, security_policy::is_allowed_navigation};

pub fn create_main_window(app: &tauri::AppHandle, runtime: RuntimeHandle) -> tauri::Result<()> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }

    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("DSH Desk")
        .inner_size(1180.0, 780.0)
        .min_inner_size(720.0, 520.0)
        .center()
        .on_navigation(move |url| {
            let status = runtime.status();
            is_allowed_navigation(url, status.url.as_deref())
        })
        .build()?;

    Ok(())
}

pub fn open_plugin_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("plugins") {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    WebviewWindowBuilder::new(app, "plugins", WebviewUrl::App("plugins.html".into()))
        .title("插件管理 · DSH Desk")
        .inner_size(820.0, 680.0)
        .min_inner_size(620.0, 520.0)
        .center()
        .build()?;

    Ok(())
}

pub fn open_update_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("updates") {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    WebviewWindowBuilder::new(app, "updates", WebviewUrl::App("update.html".into()))
        .title("软件更新 · DSH Desk")
        .inner_size(560.0, 650.0)
        .min_inner_size(440.0, 570.0)
        .resizable(true)
        .center()
        .build()?;

    Ok(())
}

pub fn navigate_to_runtime(app: &tauri::AppHandle, value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|error| format!("invalid runtime URL: {error}"))?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    window.navigate(url).map_err(|error| error.to_string())
}

pub fn restore_bootstrap(app: &tauri::AppHandle, runtime: RuntimeHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.destroy().map_err(|error| error.to_string())?;
    }
    create_main_window(app, runtime).map_err(|error| error.to_string())
}
