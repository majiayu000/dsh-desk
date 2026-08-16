use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

use crate::{runtime_supervisor::RuntimeHandle, security_policy::is_allowed_navigation};

pub const PLUGIN_REGISTRY_URL: &str = "https://plugin.dshdesk.com/";

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
        .inner_size(820.0, 740.0)
        .min_inner_size(620.0, 560.0)
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

pub fn open_plugin_registry() -> Result<(), String> {
    open_system_target(PLUGIN_REGISTRY_URL)
}

fn open_system_target(target: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("cmd");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");

    #[cfg(target_os = "windows")]
    {
        command.args(["/C", "start", "", target]);
    }
    #[cfg(not(target_os = "windows"))]
    {
        command.arg(target);
    }

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开社区插件目录：{error}"))
}

pub fn restore_bootstrap(app: &tauri::AppHandle, runtime: RuntimeHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.destroy().map_err(|error| error.to_string())?;
    }
    create_main_window(app, runtime).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::PLUGIN_REGISTRY_URL;
    use url::Url;

    #[test]
    fn plugin_registry_url_is_the_public_https_site() {
        let url = Url::parse(PLUGIN_REGISTRY_URL).expect("plugin registry URL must parse");
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("plugin.dshdesk.com"));
        assert_eq!(url.path(), "/");
        assert!(url.username().is_empty());
        assert_eq!(url.port(), None);
        assert_eq!(url.query(), None);
        assert_eq!(url.fragment(), None);
    }
}
