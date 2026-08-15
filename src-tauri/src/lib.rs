mod harness_command;
mod plugin_manager;
mod process_termination;
mod runtime_supervisor;
mod security_policy;
mod updater;
mod window_manager;

use std::{process::Command, sync::Mutex};

use plugin_manager::{
    InstalledPlugin, PluginCommandRequest, PluginCommandResult, PluginInspection,
    list_installed_plugins,
};
use runtime_supervisor::{RuntimeHandle, RuntimeStatus, diagnostic_dir, spawn_worker};
use tauri::{
    Manager,
    menu::{MenuBuilder, SubmenuBuilder},
};

#[tauri::command]
fn get_runtime_status(runtime: tauri::State<'_, RuntimeHandle>) -> RuntimeStatus {
    runtime.status()
}

#[tauri::command]
fn restart_runtime(runtime: tauri::State<'_, RuntimeHandle>) -> Result<(), String> {
    runtime.restart()
}

#[tauri::command]
fn open_diagnostic_folder(app: tauri::AppHandle) -> Result<(), String> {
    let path = diagnostic_dir(&app).map_err(|error| error.message)?;
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;

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
fn get_desktop_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

fn require_plugin_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "plugins" {
        Ok(())
    } else {
        Err("plugin commands are available only in the plugin manager".to_string())
    }
}

#[tauri::command]
fn list_plugins(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Vec<InstalledPlugin>, String> {
    require_plugin_window(&window)?;
    list_installed_plugins(&app)
}

#[tauri::command]
async fn run_plugin_command(
    window: tauri::WebviewWindow,
    runtime: tauri::State<'_, RuntimeHandle>,
    request: PluginCommandRequest,
) -> Result<PluginCommandResult, String> {
    require_plugin_window(&window)?;
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
    require_plugin_window(&window)?;
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.inspect_plugin(operand))
        .await
        .map_err(|error| error.to_string())?
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
            let application = SubmenuBuilder::new(app, "DSH Desk")
                .about(None)
                .separator()
                .text("open-plugins", "插件管理…")
                .text("check-updates", "检查更新…")
                .separator()
                .quit()
                .build()?;
            MenuBuilder::new(app).item(&application).build()
        })
        .on_menu_event(|app, event| {
            if event.id() == "open-plugins" {
                let _ = window_manager::open_plugin_window(app);
            } else if event.id() == "check-updates" {
                updater::request_check(app.clone(), true);
            }
        })
        .manage(runtime.clone())
        .manage(updater::UpdateCoordinator::default())
        .invoke_handler(tauri::generate_handler![
            get_runtime_status,
            restart_runtime,
            open_diagnostic_folder,
            get_desktop_version,
            list_plugins,
            inspect_plugin_source,
            run_plugin_command,
        ])
        .setup(move |app| {
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
            updater::request_check(app.clone(), false);
        }
        tauri::RunEvent::ExitRequested { api, .. } => {
            if let Err(error) = app.state::<RuntimeHandle>().shutdown_blocking() {
                eprintln!("refusing to exit while the Harness process tree may be alive: {error}");
                api.prevent_exit();
            }
        }
        _ => {}
    });
}
