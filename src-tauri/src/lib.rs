mod harness_command;
mod log_redact;
mod plugin_manager;
mod process_termination;
mod runtime_supervisor;
mod secure_fs;
mod security_policy;
mod updater;
mod window_manager;

use std::{process::Command, sync::Mutex};

use plugin_manager::{
    InstalledPlugin, PluginCommandRequest, PluginCommandResult, PluginInspection,
    list_installed_plugins,
};
use runtime_supervisor::{RuntimeHandle, RuntimeStatus, diagnostic_dir, spawn_worker};
use security_policy::window_can_invoke;
use tauri::{
    Manager,
    menu::{MenuBuilder, SubmenuBuilder},
};

fn require_command_window(window: &tauri::WebviewWindow, command: &str) -> Result<(), String> {
    if window_can_invoke(window.label(), command) {
        Ok(())
    } else {
        Err(format!(
            "{command} is available only in its assigned window"
        ))
    }
}

#[tauri::command]
fn get_runtime_status(
    window: tauri::WebviewWindow,
    runtime: tauri::State<'_, RuntimeHandle>,
) -> Result<RuntimeStatus, String> {
    require_command_window(&window, "get_runtime_status")?;
    Ok(runtime.status())
}

#[tauri::command]
fn restart_runtime(
    window: tauri::WebviewWindow,
    runtime: tauri::State<'_, RuntimeHandle>,
) -> Result<(), String> {
    require_command_window(&window, "restart_runtime")?;
    runtime.restart()
}

#[tauri::command]
fn open_diagnostic_folder(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    require_command_window(&window, "open_diagnostic_folder")?;
    let path = diagnostic_dir(&app).map_err(|error| error.message)?;
    crate::secure_fs::ensure_private_dir(&path).map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer.exe");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");

    command
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_desktop_version(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<String, String> {
    require_command_window(&window, "get_desktop_version")?;
    Ok(app.package_info().version.to_string())
}

#[tauri::command]
fn get_update_status(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<updater::UpdateStatus, String> {
    require_command_window(&window, "get_update_status")?;
    updater::status(&app)
}

#[tauri::command]
fn check_for_updates(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_command_window(&window, "check_for_updates")?;
    updater::request_check(app);
    Ok(())
}

#[tauri::command]
fn download_update(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_command_window(&window, "download_update")?;
    updater::request_download(app);
    Ok(())
}

#[tauri::command]
fn install_update(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_command_window(&window, "install_update")?;
    updater::request_install(app);
    Ok(())
}

#[tauri::command]
fn set_update_auto_download(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<updater::UpdateStatus, String> {
    require_command_window(&window, "set_update_auto_download")?;
    updater::set_auto_download(&app, enabled)
}

#[tauri::command]
fn list_plugins(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Vec<InstalledPlugin>, String> {
    require_command_window(&window, "list_plugins")?;
    list_installed_plugins(&app)
}

#[tauri::command]
async fn run_plugin_command(
    window: tauri::WebviewWindow,
    runtime: tauri::State<'_, RuntimeHandle>,
    request: PluginCommandRequest,
) -> Result<PluginCommandResult, String> {
    require_command_window(&window, "run_plugin_command")?;
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.run_plugin(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn inspect_plugin_source(
    window: tauri::WebviewWindow,
    runtime: tauri::State<'_, RuntimeHandle>,
    operand: String,
) -> Result<PluginInspection, String> {
    require_command_window(&window, "inspect_plugin_source")?;
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.inspect_plugin(operand))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn open_plugin_registry(window: tauri::WebviewWindow) -> Result<(), String> {
    require_command_window(&window, "open_plugin_registry")?;
    window_manager::open_plugin_registry()
}

pub fn run() {
    let (runtime, command_rx) = RuntimeHandle::new();
    let setup_receiver = Mutex::new(Some(command_rx));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .menu(|app| {
            let application = SubmenuBuilder::with_id(app, "application-menu", "DSH Desk")
                .about(None)
                .separator()
                .text("open-plugins", "插件管理…")
                .text("software-update", "软件更新…")
                .separator()
                .quit()
                .build()?;
            let menu = MenuBuilder::new(app).item(&application);

            #[cfg(target_os = "macos")]
            {
                let edit = SubmenuBuilder::new(app, "编辑")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;
                return menu.item(&edit).build();
            }

            #[cfg(not(target_os = "macos"))]
            menu.build()
        })
        .on_menu_event(|app, event| {
            if event.id() == "open-plugins" {
                let _ = window_manager::open_plugin_window(app);
            } else if event.id() == "software-update" {
                if window_manager::open_update_window(app).is_ok() {
                    updater::request_check_if_idle(app.clone());
                }
            }
        })
        .manage(runtime.clone())
        .manage(updater::UpdateCoordinator::default())
        .invoke_handler(tauri::generate_handler![
            get_runtime_status,
            restart_runtime,
            open_diagnostic_folder,
            get_desktop_version,
            get_update_status,
            check_for_updates,
            download_update,
            install_update,
            set_update_auto_download,
            list_plugins,
            inspect_plugin_source,
            run_plugin_command,
            open_plugin_registry,
        ])
        .setup(move |app| {
            updater::initialize(app.handle());
            window_manager::create_main_window(app.handle(), runtime.clone())?;
            let receiver = setup_receiver
                .lock()
                .expect("setup receiver mutex poisoned")
                .take()
                .expect("runtime worker already started");
            spawn_worker(app.handle().clone(), runtime.clone(), receiver);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build DSH Desk");

    app.run(|app, event| match event {
        tauri::RunEvent::Ready if !cfg!(debug_assertions) => {
            updater::request_check(app.clone());
        }
        tauri::RunEvent::ExitRequested { code, api, .. }
            if code != Some(tauri::RESTART_EXIT_CODE) && updater::is_installing(app) =>
        {
            eprintln!("refusing to exit while a verified update is being installed");
            api.prevent_exit();
        }
        tauri::RunEvent::ExitRequested { code, api, .. }
            if code != Some(tauri::RESTART_EXIT_CODE) =>
        {
            if let Err(error) = app.state::<RuntimeHandle>().shutdown_blocking() {
                eprintln!("refusing to exit while the Harness process tree may be alive: {error}");
                api.prevent_exit();
            }
        }
        _ => {}
    });
}
