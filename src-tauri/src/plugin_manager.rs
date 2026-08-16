use std::{
    ffi::OsString,
    fs,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::harness_command::harness_command;
use crate::process_termination::run_command_with_timeout;

const MAX_PLUGIN_ARCHIVE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const PROFILE_STATE_FILES: [&str; 3] = ["package.json", "pnpm-lock.yaml", "cordis.patch.yml"];
/// Plugin subprocesses run inline on the single supervisor thread, so every
/// one of them needs a hard deadline; a hung `dsh`/`pnpm` call would
/// otherwise block Restart/Shutdown and the app quit forever.
const PLUGIN_COMMAND_TIMEOUT: Duration = Duration::from_secs(300);
const PLUGIN_VALIDATION_TIMEOUT: Duration = Duration::from_secs(60);
const PLUGIN_REPAIR_TIMEOUT: Duration = Duration::from_secs(300);
const PLUGIN_REGISTRY_VIEW_TIMEOUT: Duration = Duration::from_secs(60);

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
    #[serde(default)]
    pub confirmed_risk: bool,
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
    pub rolled_back: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub name: String,
    pub requested: String,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginSourceKind {
    Registry,
    Github,
    Directory,
    Tarball,
    Url,
    Unknown,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginRiskLevel {
    Low,
    Review,
    High,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInspection {
    pub source: String,
    pub kind: PluginSourceKind,
    pub name: Option<String>,
    pub version: Option<String>,
    pub integrity: Option<String>,
    pub repository: Option<String>,
    pub trust_signal: String,
    pub lifecycle_scripts: Vec<String>,
    pub risk: PluginRiskLevel,
    pub warnings: Vec<String>,
    pub permission_notice: String,
}

struct ProfileBackup {
    profile_dir: PathBuf,
    existed: bool,
    files: Vec<(String, Option<Vec<u8>>)>,
}

impl ProfileBackup {
    fn capture(profile_dir: PathBuf) -> Result<Self, String> {
        let existed = profile_dir.is_dir();
        let files = PROFILE_STATE_FILES
            .into_iter()
            .map(|name| {
                let path = profile_dir.join(name);
                fs::read(&path)
                    .map(Some)
                    .or_else(|error| {
                        if error.kind() == std::io::ErrorKind::NotFound {
                            Ok(None)
                        } else {
                            Err(error)
                        }
                    })
                    .map(|value| (name.to_string(), value))
                    .map_err(|error| format!("备份插件 Profile 失败：{error}"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            profile_dir,
            existed,
            files,
        })
    }

    fn restore(&self) -> Result<(), String> {
        if !self.existed {
            if self.profile_dir.exists() {
                fs::remove_dir_all(&self.profile_dir)
                    .map_err(|error| format!("清理失败的插件 Profile 失败：{error}"))?;
            }
            return Ok(());
        }

        fs::create_dir_all(&self.profile_dir)
            .map_err(|error| format!("恢复插件 Profile 目录失败：{error}"))?;
        for (name, contents) in &self.files {
            let path = self.profile_dir.join(name);
            match contents {
                Some(contents) => atomic_write(&path, contents)?,
                None if path.exists() => fs::remove_file(&path)
                    .map_err(|error| format!("恢复插件 Profile 失败：{error}"))?,
                None => {}
            }
        }
        Ok(())
    }
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("dsh-desk-rollback.tmp");
    fs::write(&temporary, contents).map_err(|error| format!("写入回滚文件失败：{error}"))?;
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("替换回滚文件失败：{error}"))?;
    }
    fs::rename(&temporary, path).map_err(|error| format!("切换回滚文件失败：{error}"))
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
    if request.is_mutating() && !request.confirmed_risk {
        return Err("安装、升级或卸载前必须在插件管理器中确认操作风险。".to_string());
    }

    let home = dsh_home(app)?;
    fs::create_dir_all(&home).map_err(|error| format!("创建 Harness 数据目录失败：{error}"))?;
    let workspace = app.path().home_dir().map_err(|error| error.to_string())?;
    let path = plugin_path(node, entry)?;
    let profile_dir = home.join("profiles/web");
    let backup = request
        .is_mutating()
        .then(|| ProfileBackup::capture(profile_dir.clone()))
        .transpose()?;

    let mut plugin_command = harness_command(node, entry);
    plugin_command
        .args(["plugin", "--profile", "web", request.action.as_str()])
        .arg(&request.operand)
        .current_dir(&workspace)
        .env("DSH_HOME", &home)
        .env("PATH", &path)
        .env("NO_COLOR", "1");
    let output = run_command_with_timeout(&mut plugin_command, PLUGIN_COMMAND_TIMEOUT)
        .map_err(|error| format!("无法运行原版 dsh plugin：{error}"))?;

    let mut success = output.status.success();
    let mut exit_code = output.status.code();
    let mut stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if success && request.is_mutating() {
        let mut validation_command = harness_command(node, entry);
        validation_command
            .args(["--profile", "web", "--dump-config"])
            .current_dir(&workspace)
            .env("DSH_HOME", &home)
            .env("PATH", &path)
            .env("NO_COLOR", "1");
        let validation =
            run_command_with_timeout(&mut validation_command, PLUGIN_VALIDATION_TIMEOUT);
        match validation {
            Ok(validation) if !validation.status.success() => {
                success = false;
                exit_code = validation.status.code();
                stderr.push_str("\n插件命令执行后组合配置验证失败：\n");
                stderr.push_str(&String::from_utf8_lossy(&validation.stderr));
            }
            Err(error) => {
                success = false;
                exit_code = None;
                stderr.push_str(&format!("\n无法验证插件组合配置：{error}\n"));
            }
            Ok(_) => {}
        }
    }

    let mut rolled_back = false;
    if !success && let Some(backup) = backup {
        match backup.restore().and_then(|_| {
            if backup.existed {
                repair_profile(node, entry, &profile_dir, &path)
            } else {
                Ok(())
            }
        }) {
            Ok(()) => {
                rolled_back = true;
                stderr.push_str("\nDSH Desk 已恢复操作前的插件 Profile。\n");
            }
            Err(error) => {
                stderr.push_str(
                    "\n插件 Profile 自动恢复失败；已停止 Harness，请勿继续使用当前 Profile。\n",
                );
                stderr.push_str(&error);
                stderr.push('\n');
            }
        }
    }

    Ok(PluginCommandResult {
        success,
        exit_code,
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr,
        rolled_back,
    })
}

fn plugin_path(node: &Path, entry: &Path) -> Result<OsString, String> {
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
    std::env::join_paths(search_paths).map_err(|error| format!("构造插件安装 PATH 失败：{error}"))
}

fn repair_profile(
    node: &Path,
    entry: &Path,
    profile_dir: &Path,
    path: &OsString,
) -> Result<(), String> {
    let node_modules = entry
        .ancestors()
        .nth(4)
        .ok_or_else(|| "无法定位内置插件运行环境。".to_string())?;
    let mut command = Command::new(node);
    command
        .arg(node_modules.join("pnpm/bin/pnpm.cjs"))
        .args(["install", "--frozen-lockfile"])
        .current_dir(profile_dir)
        .env("PATH", path)
        .env("NO_COLOR", "1");
    let output = run_command_with_timeout(&mut command, PLUGIN_REPAIR_TIMEOUT)
        .map_err(|error| format!("无法重新安装回滚后的插件依赖：{error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "重新安装回滚依赖失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

pub(crate) fn inspect_plugin_source(
    app: &tauri::AppHandle,
    operand: &str,
    node: &Path,
    entry: &Path,
) -> Result<PluginInspection, String> {
    let source = operand.trim();
    if source.is_empty() {
        return Err("请输入插件包名、地址或路径。".to_string());
    }
    let workspace = app.path().home_dir().map_err(|error| error.to_string())?;
    let (kind, local_path) = classify_source(source, &workspace);
    let manifest = match kind {
        PluginSourceKind::Directory => local_path
            .as_deref()
            .map(|path| read_manifest(&path.join("package.json")))
            .transpose()?,
        PluginSourceKind::Tarball => local_path
            .as_deref()
            .map(read_tarball_manifest)
            .transpose()?,
        PluginSourceKind::Registry => {
            Some(read_registry_manifest(node, entry, source, &workspace)?)
        }
        _ => None,
    };
    Ok(build_inspection(source, kind, manifest))
}

fn classify_source(source: &str, workspace: &Path) -> (PluginSourceKind, Option<PathBuf>) {
    let path_value = source.strip_prefix("file:").unwrap_or(source);
    let path = PathBuf::from(path_value);
    let candidate = if path.is_absolute() {
        path
    } else {
        workspace.join(path)
    };
    if candidate.is_dir() {
        return (PluginSourceKind::Directory, Some(candidate));
    }
    if candidate.is_file() && candidate.extension().and_then(|value| value.to_str()) == Some("tgz")
    {
        return (PluginSourceKind::Tarball, Some(candidate));
    }
    let lower = source.to_ascii_lowercase();
    if lower.starts_with("github:")
        || lower.starts_with("git+https://github.com/")
        || lower.starts_with("https://github.com/")
    {
        return (PluginSourceKind::Github, None);
    }
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return (PluginSourceKind::Url, None);
    }
    if source
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "@/._~-".contains(character))
    {
        return (PluginSourceKind::Registry, None);
    }
    (PluginSourceKind::Unknown, None)
}

fn read_manifest(path: &Path) -> Result<serde_json::Value, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("无法读取插件 package.json：{error}"))?;
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err("插件 package.json 超过 1 MiB，拒绝检查。".to_string());
    }
    serde_json::from_slice(
        &fs::read(path).map_err(|error| format!("无法读取插件 package.json：{error}"))?,
    )
    .map_err(|error| format!("插件 package.json 格式无效：{error}"))
}

fn read_tarball_manifest(path: &Path) -> Result<serde_json::Value, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("无法读取插件 TGZ：{error}"))?;
    if metadata.len() > MAX_PLUGIN_ARCHIVE_BYTES {
        return Err("插件 TGZ 超过 50 MiB，拒绝检查。".to_string());
    }
    let decoder =
        GzDecoder::new(File::open(path).map_err(|error| format!("无法打开插件 TGZ：{error}"))?);
    let mut archive = tar::Archive::new(decoder);
    for item in archive
        .entries()
        .map_err(|error| format!("无法解析插件 TGZ：{error}"))?
    {
        let mut item = item.map_err(|error| format!("无法解析插件 TGZ：{error}"))?;
        let item_path = item
            .path()
            .map_err(|error| format!("TGZ 路径无效：{error}"))?;
        if item_path == Path::new("package/package.json") || item_path == Path::new("package.json")
        {
            if item.size() > MAX_MANIFEST_BYTES {
                return Err("插件 TGZ 中的 package.json 超过 1 MiB。".to_string());
            }
            let mut contents = Vec::new();
            item.read_to_end(&mut contents)
                .map_err(|error| format!("无法读取 TGZ package.json：{error}"))?;
            return serde_json::from_slice(&contents)
                .map_err(|error| format!("TGZ package.json 格式无效：{error}"));
        }
    }
    Err("插件 TGZ 中没有 package/package.json。".to_string())
}

fn read_registry_manifest(
    node: &Path,
    entry: &Path,
    source: &str,
    workspace: &Path,
) -> Result<serde_json::Value, String> {
    let node_modules = entry
        .ancestors()
        .nth(4)
        .ok_or_else(|| "无法定位内置插件运行环境。".to_string())?;
    let mut command = Command::new(node);
    command
        .arg(node_modules.join("pnpm/bin/pnpm.cjs"))
        .args([
            "view",
            source,
            "name",
            "version",
            "dist.integrity",
            "scripts",
            "repository",
            "--json",
        ])
        .current_dir(workspace)
        .env("NO_COLOR", "1");
    let output = run_command_with_timeout(&mut command, PLUGIN_REGISTRY_VIEW_TIMEOUT)
        .map_err(|error| format!("无法查询 npm 插件元数据：{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "npm 插件元数据查询失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("npm 插件元数据格式无效：{error}"))
}

fn build_inspection(
    source: &str,
    kind: PluginSourceKind,
    manifest: Option<serde_json::Value>,
) -> PluginInspection {
    let name = manifest
        .as_ref()
        .and_then(|value| value.get("name"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let version = manifest
        .as_ref()
        .and_then(|value| value.get("version"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let integrity = manifest
        .as_ref()
        .and_then(|value| value.get("dist.integrity"))
        .or_else(|| {
            manifest
                .as_ref()
                .and_then(|value| value.pointer("/dist/integrity"))
        })
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let repository = manifest
        .as_ref()
        .and_then(|value| value.get("repository"))
        .and_then(|value| {
            value
                .as_str()
                .or_else(|| value.get("url").and_then(serde_json::Value::as_str))
        })
        .map(str::to_string);
    let lifecycle_scripts = manifest
        .as_ref()
        .and_then(|value| value.get("scripts"))
        .and_then(serde_json::Value::as_object)
        .map(|scripts| {
            scripts
                .iter()
                .filter(|(name, _)| {
                    matches!(
                        name.as_str(),
                        "preinstall" | "install" | "postinstall" | "prepare" | "prepack"
                    )
                })
                .map(|(name, command)| {
                    format!("{name}: {}", command.as_str().unwrap_or("<非字符串命令>"))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut warnings = Vec::new();
    if !lifecycle_scripts.is_empty() {
        warnings.push(format!(
            "安装可能执行生命周期脚本：{}。这些脚本具有当前用户权限。",
            lifecycle_scripts.join("、")
        ));
    }
    match kind {
        PluginSourceKind::Registry if integrity.is_none() => {
            warnings.push("npm 元数据没有提供 dist.integrity，无法锁定下载内容。".to_string());
        }
        PluginSourceKind::Github => warnings.push(
            "GitHub 来源没有不可变 commit 与包完整性证明，当前只能作为未验证来源安装。".to_string(),
        ),
        PluginSourceKind::Url => warnings
            .push("远程 URL 没有可信签名或完整性元数据，当前只能作为未验证来源安装。".to_string()),
        PluginSourceKind::Unknown => {
            warnings.push("无法识别插件来源，拒绝把它视为可信包。".to_string())
        }
        PluginSourceKind::Directory | PluginSourceKind::Tarball => {
            warnings.push("本地来源可以检查 package.json，但没有维护者身份或发布签名。".to_string())
        }
        PluginSourceKind::Registry => {}
    }
    let risk = if !lifecycle_scripts.is_empty()
        || matches!(
            kind,
            PluginSourceKind::Github | PluginSourceKind::Url | PluginSourceKind::Unknown
        )
        || matches!(kind, PluginSourceKind::Registry) && integrity.is_none()
    {
        PluginRiskLevel::High
    } else if matches!(
        kind,
        PluginSourceKind::Directory | PluginSourceKind::Tarball
    ) {
        PluginRiskLevel::Review
    } else {
        PluginRiskLevel::Low
    };
    let trust_signal = match kind {
        PluginSourceKind::Registry if integrity.is_some() => {
            "npm integrity（只能校验内容，不代表维护者签名）".to_string()
        }
        PluginSourceKind::Directory | PluginSourceKind::Tarball => {
            "本地来源（没有发布者身份验证）".to_string()
        }
        _ => "未验证来源".to_string(),
    };

    PluginInspection {
        source: source.to_string(),
        kind,
        name,
        version,
        integrity,
        repository,
        trust_signal,
        lifecycle_scripts,
        risk,
        warnings,
        permission_notice: "DSH 目前没有标准化插件权限清单。安装后的插件及其依赖与 Harness 同进程运行，可能访问 Harness 已获准的文件、网络、命令和凭据能力；顶层 package.json 未出现脚本也不能证明所有传递依赖都没有脚本。".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{
        PluginAction, PluginCommandRequest, PluginRiskLevel, PluginSourceKind, ProfileBackup,
        build_inspection, classify_source, profile_dependencies,
    };

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

    #[test]
    fn classifies_registry_github_and_local_sources() {
        let root = std::env::temp_dir().join(format!("dsh-plugin-source-{}", std::process::id()));
        let local = root.join("plugin");
        fs::create_dir_all(&local).unwrap();
        assert_eq!(
            classify_source("@scope/plugin@1.0.0", &root).0,
            PluginSourceKind::Registry
        );
        assert_eq!(
            classify_source("github:owner/repo", &root).0,
            PluginSourceKind::Github
        );
        assert_eq!(
            classify_source(local.to_str().unwrap(), &root).0,
            PluginSourceKind::Directory
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn lifecycle_scripts_raise_the_inspection_to_high_risk() {
        let manifest = serde_json::json!({
            "name": "plugin",
            "version": "1.0.0",
            "dist.integrity": "sha512-example",
            "scripts": { "postinstall": "node setup.js", "test": "node test.js" }
        });
        let inspection = build_inspection("plugin", PluginSourceKind::Registry, Some(manifest));
        assert_eq!(inspection.risk, PluginRiskLevel::High);
        assert_eq!(
            inspection.lifecycle_scripts,
            vec!["postinstall: node setup.js"]
        );
    }

    #[test]
    fn failed_profile_changes_restore_declarative_state() {
        let root = std::env::temp_dir().join(format!("dsh-plugin-backup-{}", std::process::id()));
        let profile = root.join("profiles/web");
        fs::create_dir_all(&profile).unwrap();
        fs::write(profile.join("package.json"), b"before").unwrap();
        let backup = ProfileBackup::capture(PathBuf::from(&profile)).unwrap();
        fs::write(profile.join("package.json"), b"after").unwrap();
        fs::write(profile.join("pnpm-lock.yaml"), b"new").unwrap();
        backup.restore().unwrap();
        assert_eq!(fs::read(profile.join("package.json")).unwrap(), b"before");
        assert!(!profile.join("pnpm-lock.yaml").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
