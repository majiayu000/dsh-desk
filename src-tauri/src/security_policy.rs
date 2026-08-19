use url::Url;

pub fn is_allowed_navigation(candidate: &Url, runtime_url: Option<&str>) -> bool {
    if candidate.scheme() == "tauri" || candidate.host_str() == Some("tauri.localhost") {
        return true;
    }

    #[cfg(debug_assertions)]
    if candidate.scheme() == "http"
        && candidate.host_str() == Some("127.0.0.1")
        && candidate.port() == Some(1420)
    {
        return true;
    }

    let Some(expected) = runtime_url.and_then(|value| Url::parse(value).ok()) else {
        return false;
    };

    candidate.scheme() == expected.scheme()
        && candidate.host_str() == expected.host_str()
        && candidate.port_or_known_default() == expected.port_or_known_default()
}

pub fn window_can_invoke(window_label: &str, command: &str) -> bool {
    allowed_commands_for_window(window_label).contains(&command)
}

fn allowed_commands_for_window(window_label: &str) -> &'static [&'static str] {
    match window_label {
        "main" => &[
            "get_runtime_status",
            "restart_runtime",
            "open_diagnostic_folder",
            "get_desktop_version",
        ],
        "plugins" => &[
            "list_plugins",
            "inspect_plugin_source",
            "run_plugin_command",
            "open_plugin_registry",
        ],
        "updates" => &[
            "get_update_status",
            "check_for_updates",
            "download_update",
            "install_update",
            "set_update_auto_download",
        ],
        _ => &[],
    }
}

#[cfg(test)]
mod tests {
    use super::{is_allowed_navigation, window_can_invoke};
    use url::Url;

    #[test]
    fn allows_only_the_exact_runtime_origin() {
        let runtime = "http://127.0.0.1:43123";
        assert!(is_allowed_navigation(
            &Url::parse("http://127.0.0.1:43123/session/one").unwrap(),
            Some(runtime),
        ));
        assert!(!is_allowed_navigation(
            &Url::parse("http://127.0.0.1:43124").unwrap(),
            Some(runtime),
        ));
        assert!(!is_allowed_navigation(
            &Url::parse("https://example.com").unwrap(),
            Some(runtime),
        ));
    }

    #[test]
    fn allows_the_bundled_bootstrap_without_a_runtime() {
        assert!(is_allowed_navigation(
            &Url::parse("tauri://localhost/index.html").unwrap(),
            None,
        ));
    }

    #[test]
    fn each_window_can_only_invoke_its_own_commands() {
        assert!(window_can_invoke("main", "restart_runtime"));
        assert!(window_can_invoke("plugins", "run_plugin_command"));
        assert!(window_can_invoke("plugins", "open_plugin_registry"));
        assert!(window_can_invoke("updates", "install_update"));
        assert!(!window_can_invoke("plugins", "restart_runtime"));
        assert!(!window_can_invoke("updates", "run_plugin_command"));
        assert!(!window_can_invoke("main", "install_update"));
        assert!(!window_can_invoke("unknown", "get_runtime_status"));
    }

    #[test]
    fn capability_files_grant_only_the_matching_command_sets() {
        let bootstrap = capability_permissions("bootstrap.json");
        let plugins = capability_permissions("plugins.json");
        let updates = capability_permissions("updates.json");

        assert!(bootstrap.iter().any(|value| value == "desktop-bootstrap"));
        assert!(plugins.iter().any(|value| value == "desktop-plugins"));
        assert!(updates.iter().any(|value| value == "desktop-updates"));
        assert!(!bootstrap.iter().any(|value| value == "desktop-plugins"));
        assert!(!plugins.iter().any(|value| value == "desktop-updates"));
        assert!(!updates.iter().any(|value| value.starts_with("updater:")));
    }

    fn capability_permissions(name: &str) -> Vec<String> {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("capabilities")
            .join(name);
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap_or_else(|error| {
                panic!(
                    "capability file {} must be readable: {error}",
                    path.display()
                )
            }))
            .unwrap_or_else(|error| panic!("capability file {name} must be JSON: {error}"));
        value
            .get("permissions")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(serde_json::Value::as_str)
            .map(str::to_string)
            .collect()
    }
}
