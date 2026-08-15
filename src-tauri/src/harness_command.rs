use std::{path::Path, process::Command};

#[cfg(any(windows, test))]
const WINDOWS_RUNTIME_ENTRY_ENV: &str = "DSH_DESKTOP_RESOLVED_ENTRY";
#[cfg(any(windows, test))]
const WINDOWS_RUNTIME_BOOTSTRAP: &str = "import{pathToFileURL}from'node:url';process.argv.splice(1,0,process.env.DSH_DESKTOP_RESOLVED_ENTRY);await import(pathToFileURL(process.env.DSH_DESKTOP_RESOLVED_ENTRY).href)";

#[cfg(any(windows, test))]
fn bootstrap_harness_command(node: &Path, entry: &Path) -> Command {
    let mut command = Command::new(node);
    command
        .args([
            "--input-type=module",
            "--eval",
            WINDOWS_RUNTIME_BOOTSTRAP,
            "--",
        ])
        .env(WINDOWS_RUNTIME_ENTRY_ENV, entry);
    command
}

#[cfg(windows)]
pub(crate) fn harness_command(node: &Path, entry: &Path) -> Command {
    bootstrap_harness_command(node, entry)
}

#[cfg(not(windows))]
pub(crate) fn harness_command(node: &Path, entry: &Path) -> Command {
    let mut command = Command::new(node);
    command.arg(entry);
    command
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, process, time::SystemTime};

    use super::bootstrap_harness_command;

    #[test]
    fn bootstrap_preserves_a_spaced_entry_path_and_harness_arguments() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("test clock must follow the Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "dsh desk spaced runtime test-{}-{unique}",
            process::id()
        ));
        let entry = root.join("runtime entry.mjs");
        fs::create_dir_all(&root).expect("spaced test directory must be created");
        fs::write(
            &entry,
            "process.stdout.write(JSON.stringify(process.argv.slice(1)))\n",
        )
        .expect("test runtime entry must be written");

        let node = if cfg!(windows) { "node.exe" } else { "node" };
        let output = bootstrap_harness_command(Path::new(node), &entry)
            .args(["web", "--port", "0"])
            .output()
            .expect("Node must execute the bootstrap command");

        let _ = fs::remove_dir_all(&root);
        assert!(
            output.status.success(),
            "bootstrap failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let arguments: Vec<String> =
            serde_json::from_slice(&output.stdout).expect("bootstrap output must be JSON argv");
        assert_eq!(
            arguments,
            [
                entry.to_string_lossy().into_owned(),
                "web".to_string(),
                "--port".to_string(),
                "0".to_string(),
            ]
        );
    }
}
