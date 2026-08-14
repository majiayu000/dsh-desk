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

#[cfg(test)]
mod tests {
    use super::is_allowed_navigation;
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
}
