use std::{path::Path, process::Command};

#[cfg(any(windows, test))]
const WINDOWS_RUNTIME_ENTRY_ENV: &str = "DSH_DESKTOP_RESOLVED_ENTRY";
#[cfg(any(windows, test))]
const WINDOWS_RUNTIME_BOOTSTRAP: &str = r#"import{registerHooks}from'node:module';import{pathToFileURL}from'node:url';const e=process.env.DSH_DESKTOP_RESOLVED_ENTRY,u=pathToFileURL(e).href;registerHooks({resolve(s,c,n){try{return n(s,c)}catch(x){if(/^(?:[./]|[a-zA-Z][a-zA-Z\d+.-]*:)/.test(s))throw x;return n(s,{...c,parentURL:u})}}});process.argv.splice(1,0,e);await import(u)"#;

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

    #[test]
    fn bootstrap_resolves_bare_modules_from_the_runtime_installation() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("test clock must follow the Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "dsh desk module fallback test-{}-{unique}",
            process::id()
        ));
        let installation = root.join("installation with spaces");
        let entry = installation.join("runtime entry.mjs");
        let fixture = installation
            .join("node_modules")
            .join("dsh-bootstrap-fixture");
        let profile = root.join("user profile").join("profile.mjs");

        fs::create_dir_all(&fixture).expect("fixture package directory must be created");
        fs::create_dir_all(profile.parent().expect("profile must have a parent"))
            .expect("profile directory must be created");
        fs::write(
            fixture.join("package.json"),
            r#"{"type":"module","exports":"./index.mjs"}"#,
        )
        .expect("fixture package manifest must be written");
        fs::write(
            fixture.join("index.mjs"),
            "export default 'runtime-module'\n",
        )
        .expect("fixture package entry must be written");
        fs::write(
            &profile,
            "import value from 'dsh-bootstrap-fixture'; process.stdout.write(value)\n",
        )
        .expect("profile module must be written");
        fs::write(
            &entry,
            "const {pathToFileURL}=await import('node:url'); await import(pathToFileURL(process.env.DSH_TEST_PROFILE).href)\n",
        )
        .expect("test runtime entry must be written");

        let node = if cfg!(windows) { "node.exe" } else { "node" };
        let output = bootstrap_harness_command(Path::new(node), &entry)
            .env("DSH_TEST_PROFILE", &profile)
            .output()
            .expect("Node must execute the module fallback bootstrap");

        let _ = fs::remove_dir_all(&root);
        assert!(
            output.status.success(),
            "bootstrap failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(output.stdout, b"runtime-module");
    }
}
