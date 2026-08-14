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
