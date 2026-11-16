use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};
use url::Url;

use crate::{runtime_supervisor::RuntimeHandle, security_policy::is_allowed_navigation};

pub const PLUGIN_REGISTRY_URL: &str = "https://plugin.dshdesk.com/";

/// Secondary privileged windows (plugins / updates) never get a runtime origin —
/// only tauri/app (and debug localhost) navigations are allowed.
fn is_allowed_secondary_window_navigation(url: &Url) -> bool {
    is_allowed_navigation(url, None)
}

pub fn create_main_window<R: Runtime>(
    app: &AppHandle<R>,
    runtime: RuntimeHandle,
) -> tauri::Result<()> {
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
        .on_navigation(is_allowed_secondary_window_navigation)
        .build()?;

    Ok(())
}

/// Preserve the running Harness page, including its in-memory session state.
/// The pinned upstream Plugins panel has no public deep link.
pub fn focus_harness_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Harness 主窗口不可用，请重新打开 DSH Desk。".to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
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
        .on_navigation(is_allowed_secondary_window_navigation)
        .build()?;

    Ok(())
}

pub fn navigate_to_runtime<R: Runtime>(app: &AppHandle<R>, value: &str) -> Result<(), String> {
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

/// Return the main window to the bundled startup and recovery page.
///
/// The window is reused. `destroy()` only queues the request on the event loop, so a
/// replacement built right after it is skipped while the old label is still registered,
/// and destroying the last window makes Tauri request an exit.
pub fn restore_bootstrap<R: Runtime>(
    app: &AppHandle<R>,
    runtime: RuntimeHandle,
) -> Result<(), String> {
    match app.get_webview_window("main") {
        Some(window) => window
            .navigate(bootstrap_url(app))
            .map_err(|error| error.to_string()),
        None => create_main_window(app, runtime).map_err(|error| error.to_string()),
    }
}

/// The address Tauri resolves `WebviewUrl::App("index.html")` to: the dev server under
/// `tauri dev`, otherwise the origin that serves the bundled frontend.
fn bootstrap_url<R: Runtime>(app: &AppHandle<R>) -> Url {
    if tauri::is_dev()
        && let Some(url) = app.config().build.dev_url.clone()
    {
        return url;
    }
    let origin = if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    Url::parse(origin).expect("bundled frontend origin must parse")
}

#[cfg(test)]
mod tests {
    use super::{
        PLUGIN_REGISTRY_URL, bootstrap_url, create_main_window,
        is_allowed_secondary_window_navigation, navigate_to_runtime, restore_bootstrap,
    };
    use crate::runtime_supervisor::RuntimeHandle;
    use tauri::Manager;
    use url::Url;

    const RUNTIME_URL: &str = "http://127.0.0.1:43123/?token=launch";

    #[test]
    fn restoring_bootstrap_reuses_the_main_window() {
        let app = tauri::test::mock_app();
        let (runtime, _commands) = RuntimeHandle::new();
        create_main_window(app.handle(), runtime.clone()).unwrap();
        let main = app.get_webview_window("main").unwrap();
        let bootstrap = main.url().unwrap();
        navigate_to_runtime(app.handle(), RUNTIME_URL).unwrap();
        assert_eq!(main.url().unwrap().as_str(), RUNTIME_URL);

        restore_bootstrap(app.handle(), runtime).unwrap();

        let restored = app
            .get_webview_window("main")
            .expect("the main window must survive a bootstrap restore");
        assert_eq!(restored.url().unwrap(), bootstrap);
    }

    #[test]
    fn restoring_bootstrap_rebuilds_a_missing_main_window() {
        let app = tauri::test::mock_app();
        let (runtime, _commands) = RuntimeHandle::new();
        assert!(app.get_webview_window("main").is_none());

        restore_bootstrap(app.handle(), runtime).unwrap();

        assert!(app.get_webview_window("main").is_some());
    }

    #[test]
    fn bootstrap_url_follows_the_dev_server_under_tauri_dev() {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().build.dev_url = Some(Url::parse("http://127.0.0.1:1420").unwrap());
        let app = tauri::test::mock_builder().build(context).unwrap();
        let (runtime, _commands) = RuntimeHandle::new();
        create_main_window(app.handle(), runtime).unwrap();
        let main = app.get_webview_window("main").unwrap();

        assert_eq!(bootstrap_url(app.handle()), main.url().unwrap());
    }

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

    #[test]
    fn secondary_windows_reject_remote_https_origins() {
        assert!(!is_allowed_secondary_window_navigation(
            &Url::parse("https://evil.example/").unwrap(),
        ));
        assert!(!is_allowed_secondary_window_navigation(
            &Url::parse("https://plugin.dshdesk.com/").unwrap(),
        ));
        assert!(!is_allowed_secondary_window_navigation(
            &Url::parse("http://127.0.0.1:43123/session").unwrap(),
        ));
    }

    #[test]
    fn secondary_windows_allow_bundled_tauri_origins() {
        assert!(is_allowed_secondary_window_navigation(
            &Url::parse("tauri://localhost/plugins.html").unwrap(),
        ));
        assert!(is_allowed_secondary_window_navigation(
            &Url::parse("https://tauri.localhost/update.html").unwrap(),
        ));
    }
}
