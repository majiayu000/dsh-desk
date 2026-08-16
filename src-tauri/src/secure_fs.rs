use std::{
    fs, io,
    path::{Path, PathBuf},
};

pub fn ensure_private_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    restrict_dir_permissions(path)
}

pub fn restrict_dir_permissions(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    let _ = path;
    Ok(())
}

pub fn resolve_workspace(
    explicit: Option<PathBuf>,
    default_workspace: PathBuf,
) -> Result<PathBuf, String> {
    match explicit {
        Some(path) if path.is_dir() => Ok(path),
        Some(path) => Err(format!("Harness 工作目录不可用：{}", path.display())),
        None => {
            ensure_private_dir(&default_workspace).map_err(|error| {
                format!(
                    "无法创建默认工作目录 {}：{error}",
                    default_workspace.display()
                )
            })?;
            Ok(default_workspace)
        }
    }
}

pub fn restrict_file_permissions(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    let _ = path;
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::{ensure_private_dir, resolve_workspace, restrict_file_permissions};
    use std::{
        fs,
        os::unix::fs::PermissionsExt,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "dsh-desk-secure-fs-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ))
    }

    #[test]
    fn private_directories_are_owner_only() {
        let root = unique_root();
        let path = root.join("harness");
        ensure_private_dir(&path).expect("private dir must be created");
        let mode = fs::metadata(&path)
            .expect("dir metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o700);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn private_files_are_owner_read_write_only() {
        let root = unique_root();
        ensure_private_dir(&root).expect("root");
        let path = root.join("runtime.log");
        fs::write(&path, b"log").expect("write");
        restrict_file_permissions(&path).expect("restrict");
        let mode = fs::metadata(&path)
            .expect("file metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn explicit_workspace_must_already_exist() {
        let root = unique_root();
        let missing = root.join("does-not-exist");
        let default = root.join("default");
        assert!(resolve_workspace(Some(missing), default).is_err());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn missing_explicit_workspace_falls_back_to_a_private_default() {
        let root = unique_root();
        let default = root.join("workspace");
        let resolved = resolve_workspace(None, default.clone()).expect("default workspace");
        assert_eq!(resolved, default);
        assert!(default.is_dir());
        let mode = fs::metadata(&default).expect("metadata").permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
        fs::remove_dir_all(root).ok();
    }
}
