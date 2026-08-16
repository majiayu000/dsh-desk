const MAX_LOG_LINE_CHARS: usize = 2048;
const SECRET_LABELS: &[&str] = &[
    "api_key",
    "apikey",
    "api-key",
    "password",
    "secret",
    "access_token",
    "token",
];

pub fn redact_log_line(line: &str) -> String {
    let mut redacted = redact_bearer(&redact_labeled_values(&redact_openai_style_keys(line)));
    if redacted.chars().count() > MAX_LOG_LINE_CHARS {
        let prefix: String = redacted.chars().take(MAX_LOG_LINE_CHARS).collect();
        redacted = format!("{prefix}… [redacted long output]");
    }
    redacted
}

fn redact_bearer(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    let mut output = String::with_capacity(line.len());
    let mut index = 0;
    while let Some(relative) = lower[index..].find("bearer ") {
        let start = index + relative;
        output.push_str(&line[index..start]);
        output.push_str("Bearer [redacted]");
        let after = &line[start + "bearer ".len()..];
        let token_len = after
            .find(|character: char| character.is_whitespace())
            .unwrap_or(after.len());
        index = start + "bearer ".len() + token_len;
    }
    output.push_str(&line[index..]);
    output
}

fn redact_labeled_values(line: &str) -> String {
    let mut output = line.to_string();
    for label in SECRET_LABELS {
        output = redact_label(&output, label);
    }
    output
}

fn redact_label(line: &str, label: &str) -> String {
    let lower = line.to_ascii_lowercase();
    let mut output = String::with_capacity(line.len());
    let mut index = 0;
    while let Some(relative) = lower[index..].find(label) {
        let start = index + relative;
        let before = start.checked_sub(1).and_then(|offset| line[offset..].chars().next());
        if !is_label_boundary(before) {
            output.push_str(&line[index..start + label.len()]);
            index = start + label.len();
            continue;
        }

        let after_label = &line[start + label.len()..];
        let Some((separator_offset, separator)) = next_assignment(after_label) else {
            output.push_str(&line[index..start + label.len()]);
            index = start + label.len();
            continue;
        };
        let after_separator = &after_label[separator_offset + separator.len_utf8()..];
        let padding_len = after_separator.len() - after_separator.trim_start().len();
        let value = &after_separator[padding_len..];
        let (redacted_value, consumed) = take_secret_value(value);
        if redacted_value.is_none() {
            output.push_str(&line[index..start + label.len()]);
            index = start + label.len();
            continue;
        }

        output.push_str(&line[index..start]);
        output.push_str(&line[start..start + label.len() + separator_offset]);
        output.push(separator);
        output.push_str(&after_separator[..padding_len]);
        output.push_str(redacted_value.expect("checked above"));
        index = start + label.len() + separator_offset + separator.len_utf8() + padding_len + consumed;
    }
    output.push_str(&line[index..]);
    output
}

fn next_assignment(after_label: &str) -> Option<(usize, char)> {
    let mut trimmed = after_label.trim_start();
    if trimmed.starts_with(['"', '\'']) {
        trimmed = trimmed[1..].trim_start();
    }
    let skipped = after_label.len() - trimmed.len();
    match trimmed.chars().next() {
        Some(separator) if separator == '=' || separator == ':' => Some((skipped, separator)),
        _ => None,
    }
}

fn take_secret_value(value: &str) -> (Option<&'static str>, usize) {
    if value.starts_with(['"', '\'']) {
        let mark = value.chars().next().expect("quote exists");
        let rest = &value[mark.len_utf8()..];
        let end = rest.find(mark).unwrap_or(rest.len());
        let closing = usize::from(rest.get(end..).is_some_and(|tail| tail.starts_with(mark)));
        return (
            Some(r#""[redacted]""#),
            mark.len_utf8() + end + closing,
        );
    }
    let end = value
        .find(|character: char| character.is_whitespace() || matches!(character, ',' | ';' | '}' | ']'))
        .unwrap_or(value.len());
    if end == 0 {
        (None, 0)
    } else {
        (Some("[redacted]"), end)
    }
}

fn is_label_boundary(before: Option<char>) -> bool {
    !matches!(before, Some(character) if character.is_ascii_alphanumeric() || character == '_')
}

fn redact_openai_style_keys(line: &str) -> String {
    let mut output = String::with_capacity(line.len());
    let mut remaining = line;
    while let Some(index) = remaining.find("sk-") {
        output.push_str(&remaining[..index]);
        let token = &remaining[index..];
        let length = token
            .bytes()
            .take_while(|byte| byte.is_ascii_alphanumeric() || *byte == b'-' || *byte == b'_')
            .count();
        if length >= 12 {
            output.push_str("sk-[redacted]");
            remaining = &remaining[index + length..];
        } else {
            output.push_str(&remaining[index..index + 3]);
            remaining = &remaining[index + 3..];
        }
    }
    output.push_str(remaining);
    output
}

#[cfg(test)]
mod tests {
    use super::redact_log_line;

    #[test]
    fn redacts_bearer_tokens_and_api_keys() {
        let line = "Authorization: Bearer secret-token-value api_key=sk-abcdefghijklmnopqrstuvwxyz";
        let redacted = redact_log_line(line);
        assert!(!redacted.contains("secret-token-value"), "{redacted}");
        assert!(!redacted.contains("sk-abcdefghijklmnopqrstuvwxyz"), "{redacted}");
        assert!(redacted.contains("[redacted]"), "{redacted}");
    }

    #[test]
    fn redacts_quoted_json_secrets() {
        let line = r#"{"password":"hunter2","prompt":"keep"}"#;
        let redacted = redact_log_line(line);
        assert!(!redacted.contains("hunter2"), "{redacted}");
        assert!(redacted.contains("keep"), "{redacted}");
    }

    #[test]
    fn truncates_long_tool_output() {
        let line = "tool result ".to_string() + &"x".repeat(3000);
        let redacted = redact_log_line(&line);
        assert!(redacted.contains("[redacted long output]"));
        assert!(redacted.len() < line.len());
    }

    #[test]
    fn leaves_ordinary_status_lines_intact() {
        assert_eq!(
            redact_log_line("dsh web: http://127.0.0.1:43123"),
            "dsh web: http://127.0.0.1:43123"
        );
    }
}
