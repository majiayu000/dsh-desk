mod runtime_supervisor;
mod security_policy;
mod window_manager;

use std::{process::Command, sync::Mutex};

use runtime_supervisor::{RuntimeHandle, RuntimeStatus, diagnostic_dir, spawn_worker};
use tauri::Manager;

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

pub fn run() {
    let (runtime, command_rx) = RuntimeHandle::new();
    let setup_receiver = Mutex::new(Some(command_rx));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(runtime.clone())
        .invoke_handler(tauri::generate_handler![
            get_runtime_status,
            restart_runtime,
            open_diagnostic_folder,
            get_desktop_version,
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

    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            app.state::<RuntimeHandle>().shutdown_blocking();
        }
    });
}
