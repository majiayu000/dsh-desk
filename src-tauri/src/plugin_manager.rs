use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginAction {
    Add,
    Remove,
    Update,
    Why,
}

impl PluginAction {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Add => "add",
            Self::Remove => "remove",
            Self::Update => "update",
            Self::Why => "why",
        }
    }

    pub(crate) fn is_mutating(&self) -> bool {
        !matches!(self, Self::Why)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandRequest {
    pub action: PluginAction,
    pub operand: String,
}

impl PluginCommandRequest {
    pub(crate) fn is_mutating(&self) -> bool {
        self.action.is_mutating()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub name: String,
    pub requested: String,
    pub version: Option<String>,
}

pub fn dsh_home(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("harness"))
        .map_err(|error| error.to_string())
}

pub fn list_installed_plugins(app: &tauri::AppHandle) -> Result<Vec<InstalledPlugin>, String> {
    let profile_dir = dsh_home(app)?.join("profiles/web");
    let manifest_path = profile_dir.join("package.json");
    if !manifest_path.is_file() {
        return Ok(Vec::new());
    }

    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(&manifest_path).map_err(|error| format!("读取 Profile 失败：{error}"))?,
    )
    .map_err(|error| format!("解析 Profile 失败：{error}"))?;
    let Some(dependencies) = profile_dependencies(&manifest)? else {
        return Ok(Vec::new());
    };

    let mut plugins = dependencies
        .iter()
        .map(|(name, requested)| InstalledPlugin {
            name: name.clone(),
            requested: requested.as_str().unwrap_or_default().to_string(),
            version: installed_version(&profile_dir, name),
        })
        .collect::<Vec<_>>();
    plugins.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(plugins)
}

fn profile_dependencies(
    manifest: &serde_json::Value,
) -> Result<Option<&serde_json::Map<String, serde_json::Value>>, String> {
    manifest
        .get("dependencies")
        .map(|value| {
            value
                .as_object()
                .ok_or_else(|| "Profile dependencies 格式无效。".to_string())
        })
        .transpose()
}

fn installed_version(profile_dir: &Path, package_name: &str) -> Option<String> {
    let manifest_path = profile_dir
        .join("node_modules")
        .join(package_name)
        .join("package.json");
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(manifest_path).ok()?).ok()?;
    manifest
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

pub(crate) fn execute_plugin_command(
    app: &tauri::AppHandle,
    request: &PluginCommandRequest,
    node: &Path,
    entry: &Path,
) -> Result<PluginCommandResult, String> {
    if request.operand.trim().is_empty() {
        return Err("请输入插件包名、地址或路径。".to_string());
    }

    let home = dsh_home(app)?;
    fs::create_dir_all(&home).map_err(|error| format!("创建 Harness 数据目录失败：{error}"))?;
    let workspace = app.path().home_dir().map_err(|error| error.to_string())?;
    let node_modules = entry
        .ancestors()
        .nth(4)
        .ok_or_else(|| "无法定位内置插件运行环境。".to_string())?;
    let runtime_root = node_modules
        .parent()
        .ok_or_else(|| "内置插件运行环境路径无效。".to_string())?;
    let mut search_paths = vec![
        runtime_root.join("tools/bin"),
        node.parent()
            .ok_or_else(|| "内置 Node 路径无效。".to_string())?
            .to_path_buf(),
    ];
    if let Some(current_path) = std::env::var_os("PATH") {
        search_paths.extend(std::env::split_paths(&current_path));
    }
    let path = std::env::join_paths(search_paths)
        .map_err(|error| format!("构造插件安装 PATH 失败：{error}"))?;

    let output = Command::new(node)
        .arg(entry)
        .args(["plugin", "--profile", "web", request.action.as_str()])
        .arg(&request.operand)
        .current_dir(workspace)
        .env("DSH_HOME", home)
        .env("PATH", OsString::from(path))
        .env("NO_COLOR", "1")
        .output()
        .map_err(|error| format!("无法运行原版 dsh plugin：{error}"))?;

    Ok(PluginCommandResult {
        success: output.status.success(),
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::{PluginAction, PluginCommandRequest, profile_dependencies};

    #[test]
    fn accepts_only_original_dsh_plugin_actions() {
        for action in ["add", "remove", "update", "why"] {
            let request: PluginCommandRequest = serde_json::from_str(&format!(
                r#"{{"action":"{action}","operand":"@scope/plugin"}}"#
            ))
            .expect("original dsh plugin action should deserialize");
            assert_eq!(request.action.as_str(), action);
        }

        assert!(
            serde_json::from_str::<PluginCommandRequest>(
                r#"{"action":"install","operand":"@scope/plugin"}"#
            )
            .is_err()
        );
    }

    #[test]
    fn why_is_the_only_read_only_action() {
        assert!(!PluginAction::Why.is_mutating());
        assert!(PluginAction::Add.is_mutating());
        assert!(PluginAction::Remove.is_mutating());
        assert!(PluginAction::Update.is_mutating());
    }

    #[test]
    fn an_upstream_profile_without_dependencies_is_an_empty_plugin_list() {
        let manifest: serde_json::Value = serde_json::from_str(
            r#"{"name":"dsh-profile-web","private":true,"dsh":{"profile":{"bundles":[]}}}"#,
        )
        .expect("fixture manifest should parse");
        assert_eq!(profile_dependencies(&manifest).unwrap(), None);
    }
}
