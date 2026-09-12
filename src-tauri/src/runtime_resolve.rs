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

/// Env entry/node overrides and the development `node_modules` fallback are debug-only.
/// Release builds must resolve exclusively to the bundled `resource_dir()/runtime` paths.
fn debug_runtime_overrides_enabled() -> bool {
    cfg!(debug_assertions)
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RuntimeSelection {
    /// Debug-only: `DSH_DESKTOP_RUNTIME_ENTRY` short-circuit.
    EnvEntry(PathBuf),
    /// Signed/packaged Node + Harness entry under `resource_dir()/runtime`.
    Bundled {
        node: PathBuf,
        entry: PathBuf,
    },
    /// Debug-only: repo `node_modules` Harness entry.
    DevelopmentEntry(PathBuf),
    Missing,
}

/// Pure path-selection helper so debug and release policy can be unit-tested without AppHandle.
fn select_runtime_paths(
    env_entry: Option<PathBuf>,
    bundled: Option<(PathBuf, PathBuf)>,
    development_entry: Option<PathBuf>,
    allow_debug_overrides: bool,
) -> RuntimeSelection {
    if allow_debug_overrides && let Some(entry) = env_entry {
        return RuntimeSelection::EnvEntry(entry);
    }

    if let Some((node, entry)) = bundled {
        return RuntimeSelection::Bundled { node, entry };
    }

    if allow_debug_overrides && let Some(entry) = development_entry {
        return RuntimeSelection::DevelopmentEntry(entry);
    }

    RuntimeSelection::Missing
}

fn select_env_node(env_node: Option<PathBuf>, allow_debug_overrides: bool) -> Option<PathBuf> {
    if allow_debug_overrides {
        env_node
    } else {
        None
    }
}

pub(super) fn resolve_runtime(
    app: &tauri::AppHandle,
) -> Result<(PathBuf, PathBuf), RuntimeFailure> {
    let env_entry = std::env::var_os("DSH_DESKTOP_RUNTIME_ENTRY").map(PathBuf::from);

    let bundled = if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_entry = resource_dir.join("runtime/node_modules/@deepseek-ai/dsh/lib/bin.js");
        let bundled_node = resource_dir.join(if cfg!(windows) {
            "runtime/node/node.exe"
        } else {
            "runtime/node/bin/node"
        });
        if bundled_entry.is_file() && bundled_node.is_file() {
            Some((bundled_node, bundled_entry))
        } else {
            None
        }
    } else {
        None
    };

    let development_entry = if debug_runtime_overrides_enabled() {
        let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri must have a parent");
        let candidate = project_root.join("node_modules/@deepseek-ai/dsh/lib/bin.js");
        candidate.is_file().then_some(candidate)
    } else {
        None
    };

    match select_runtime_paths(
        env_entry,
        bundled,
        development_entry,
        debug_runtime_overrides_enabled(),
    ) {
        RuntimeSelection::EnvEntry(entry) => Ok((resolve_node(app)?, entry)),
        RuntimeSelection::Bundled { node, entry } => {
            validate_node(&node)?;
            Ok((node, entry))
        }
        RuntimeSelection::DevelopmentEntry(entry) => Ok((resolve_node(app)?, entry)),
        RuntimeSelection::Missing => Err(RuntimeFailure {
            code: "runtime-missing",
            message: "找不到内置 DeepSeek Harness。请重新安装 DSH Desk。".to_string(),
        }),
    }
}

fn resolve_node(app: &tauri::AppHandle) -> Result<PathBuf, RuntimeFailure> {
    if let Some(path) = select_env_node(
        std::env::var_os("DSH_DESKTOP_NODE").map(PathBuf::from),
        debug_runtime_overrides_enabled(),
    ) {
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

    let message = if debug_runtime_overrides_enabled() {
        "找不到兼容的 Node.js（需要 22.19+ 或 24+）。可设置 DSH_DESKTOP_NODE 指向 Node 可执行文件。"
            .to_string()
    } else {
        "找不到兼容的 Node.js（需要 22.19+ 或 24+）。".to_string()
    };

    Err(RuntimeFailure {
        code: "node-runtime-missing",
        message,
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

#[cfg(test)]
mod tests {
    use super::{
        RuntimeSelection, debug_runtime_overrides_enabled, select_env_node, select_runtime_paths,
    };
    use std::path::PathBuf;

    fn bundled_pair() -> (PathBuf, PathBuf) {
        (
            PathBuf::from("/App.app/Contents/Resources/runtime/node/bin/node"),
            PathBuf::from(
                "/App.app/Contents/Resources/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js",
            ),
        )
    }

    #[test]
    fn release_selection_ignores_env_entry_outside_bundled_runtime() {
        let env_entry = PathBuf::from("/tmp/attacker/custom-entry.js");
        let (bundled_node, bundled_entry) = bundled_pair();

        let selection = select_runtime_paths(
            Some(env_entry),
            Some((bundled_node.clone(), bundled_entry.clone())),
            Some(PathBuf::from(
                "/repo/node_modules/@deepseek-ai/dsh/lib/bin.js",
            )),
            false,
        );

        assert_eq!(
            selection,
            RuntimeSelection::Bundled {
                node: bundled_node,
                entry: bundled_entry,
            }
        );
    }

    #[test]
    fn release_selection_fails_closed_when_only_env_or_dev_paths_exist() {
        let selection = select_runtime_paths(
            Some(PathBuf::from("/tmp/attacker/custom-entry.js")),
            None,
            Some(PathBuf::from(
                "/repo/node_modules/@deepseek-ai/dsh/lib/bin.js",
            )),
            false,
        );
        assert_eq!(selection, RuntimeSelection::Missing);
    }

    #[test]
    fn debug_selection_prefers_env_entry_before_bundled() {
        let env_entry = PathBuf::from("/tmp/dev/entry.js");
        let (bundled_node, bundled_entry) = bundled_pair();

        let selection = select_runtime_paths(
            Some(env_entry.clone()),
            Some((bundled_node, bundled_entry)),
            None,
            true,
        );

        assert_eq!(selection, RuntimeSelection::EnvEntry(env_entry));
    }

    #[test]
    fn debug_selection_falls_back_to_development_entry() {
        let development = PathBuf::from("/repo/node_modules/@deepseek-ai/dsh/lib/bin.js");
        let selection = select_runtime_paths(None, None, Some(development.clone()), true);
        assert_eq!(selection, RuntimeSelection::DevelopmentEntry(development));
    }

    #[test]
    fn release_ignores_env_node_override() {
        assert_eq!(
            select_env_node(Some(PathBuf::from("/tmp/attacker/node")), false),
            None
        );
    }

    #[test]
    fn debug_honors_env_node_override() {
        let path = PathBuf::from("/opt/homebrew/bin/node");
        assert_eq!(select_env_node(Some(path.clone()), true), Some(path));
    }

    #[test]
    fn debug_assertions_gate_matches_override_policy() {
        assert_eq!(debug_runtime_overrides_enabled(), cfg!(debug_assertions));
    }
}
