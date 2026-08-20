use std::{
    collections::HashSet,
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use tauri::Manager;

use super::RuntimeFailure;
use crate::process_termination::run_command_with_timeout;

const NODE_PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const LOGIN_SHELL_PROBE_TIMEOUT: Duration = Duration::from_secs(10);

pub(super) fn resolve_runtime(
    app: &tauri::AppHandle,
) -> Result<(PathBuf, PathBuf), RuntimeFailure> {
    if let Some(entry) = std::env::var_os("DSH_DESKTOP_RUNTIME_ENTRY") {
        return Ok((resolve_node(app)?, PathBuf::from(entry)));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_entry = resource_dir.join("runtime/node_modules/@deepseek-ai/dsh/lib/bin.js");
        let bundled_node = resource_dir.join(if cfg!(windows) {
            "runtime/node/node.exe"
        } else {
            "runtime/node/bin/node"
        });
        if bundled_entry.is_file() && bundled_node.is_file() {
            validate_node(&bundled_node)?;
            return Ok((bundled_node, bundled_entry));
        }
    }

    if cfg!(debug_assertions) {
        let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri must have a parent");
        let development_entry = project_root.join("node_modules/@deepseek-ai/dsh/lib/bin.js");
        if development_entry.is_file() {
            return Ok((resolve_node(app)?, development_entry));
        }
    }

    Err(RuntimeFailure {
        code: "runtime-missing",
        message: "找不到内置 DeepSeek Harness。请重新安装 DSH Desk。".to_string(),
    })
}

fn resolve_node(app: &tauri::AppHandle) -> Result<PathBuf, RuntimeFailure> {
    if let Some(explicit) = std::env::var_os("DSH_DESKTOP_NODE") {
        let path = PathBuf::from(explicit);
        validate_node(&path)?;
        return Ok(path);
    }

    let executable_name = if cfg!(windows) { "node.exe" } else { "node" };
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            push_candidate(&mut candidates, &mut seen, directory.join(executable_name));
        }
    }

    if let Ok(home) = app.path().home_dir() {
        push_candidate(
            &mut candidates,
            &mut seen,
            home.join(".local/share/fnm/aliases/default/bin/node"),
        );
        push_candidate(
            &mut candidates,
            &mut seen,
            home.join(".nvm/current/bin/node"),
        );
        push_candidate(&mut candidates, &mut seen, home.join(".volta/bin/node"));
    }

    for path in [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ] {
        push_candidate(&mut candidates, &mut seen, PathBuf::from(path));
    }

    if let Some(path) = node_from_login_shell() {
        push_candidate(&mut candidates, &mut seen, path);
    }

    for candidate in candidates {
        if candidate.is_file() && validate_node(&candidate).is_ok() {
            return Ok(candidate);
        }
    }

    Err(RuntimeFailure {
        code: "node-runtime-missing",
        message: "找不到兼容的 Node.js（需要 22.19+ 或 24+）。可设置 DSH_DESKTOP_NODE 指向 Node 可执行文件。".to_string(),
    })
}

fn push_candidate(candidates: &mut Vec<PathBuf>, seen: &mut HashSet<OsString>, path: PathBuf) {
    if seen.insert(path.as_os_str().to_owned()) {
        candidates.push(path);
    }
}

#[cfg(unix)]
fn node_from_login_shell() -> Option<PathBuf> {
    let shell = std::env::var_os("SHELL")
        .filter(|value| Path::new(value).is_absolute())
        .unwrap_or_else(|| OsString::from("/bin/zsh"));
    let mut command = Command::new(shell);
    command.args(["-lc", "command -v node"]);
    let output = run_command_with_timeout(&mut command, LOGIN_SHELL_PROBE_TIMEOUT).ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?;
    let path = value.lines().last()?.trim();
    (!path.is_empty()).then(|| PathBuf::from(path))
}

#[cfg(windows)]
fn node_from_login_shell() -> Option<PathBuf> {
    let mut command = Command::new("where.exe");
    command.arg("node.exe");
    let output = run_command_with_timeout(&mut command, LOGIN_SHELL_PROBE_TIMEOUT).ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?;
    value
        .lines()
        .next()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

fn validate_node(path: &Path) -> Result<(), RuntimeFailure> {
    let mut command = Command::new(path);
    command.arg("--version");
    let output = run_command_with_timeout(&mut command, NODE_PROBE_TIMEOUT).map_err(|error| {
        RuntimeFailure {
            code: "node-runtime-invalid",
            message: format!("无法运行 Node.js {}：{error}", path.display()),
        }
    })?;
    let version = String::from_utf8_lossy(&output.stdout);
    let mut parts = version.trim().trim_start_matches('v').split('.');
    let major = parts.next().and_then(|value| value.parse::<u32>().ok());
    let minor = parts.next().and_then(|value| value.parse::<u32>().ok());
    let compatible = matches!((major, minor), (Some(22), Some(minor)) if minor >= 19)
        || matches!(major, Some(major) if major >= 24);

    if output.status.success() && compatible {
        return Ok(());
    }

    Err(RuntimeFailure {
        code: "node-runtime-incompatible",
        message: format!(
            "Node.js {} 版本不兼容（检测到 {}，需要 22.19+ 或 24+）。",
            path.display(),
            version.trim()
        ),
    })
}
