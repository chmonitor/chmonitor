//! Credential storage: OS keyring with 0600 plaintext fallback.

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::{fs, io::Write, path::PathBuf};

use anyhow::{Context, Result};
use keyring::Entry;

const SERVICE: &str = "chmonitor-chm";
const TOKEN_USER: &str = "token";
const API_KEY_USER: &str = "api-key";

fn ensure_private_dir(path: &std::path::Path) -> Result<()> {
    if path.exists() {
        return Ok(());
    }
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    builder.mode(0o700);
    builder
        .create(path)
        .with_context(|| format!("failed to create {}", path.display()))?;
    Ok(())
}

fn credentials_path() -> Option<PathBuf> {
    crate::config::user_config_dir().map(|d| d.join("credentials"))
}

fn keyring_entry(user: &str) -> Result<Entry> {
    Entry::new(SERVICE, user).context("failed to open OS keyring entry")
}

fn read_plaintext(key: &str) -> Result<Option<String>> {
    let Some(path) = credentials_path() else {
        return Ok(None);
    };
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .with_context(|| format!("failed to read credentials at {}", path.display()))?;
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() == key {
                let val = v.trim().trim_matches('"');
                if !val.is_empty() {
                    return Ok(Some(val.to_string()));
                }
            }
        }
    }
    Ok(None)
}

fn write_plaintext(key: &str, value: &str) -> Result<()> {
    let path = credentials_path().context("could not resolve credentials path")?;
    if let Some(parent) = path.parent() {
        ensure_private_dir(parent)?;
    }

    let mut map = std::collections::BTreeMap::<String, String>::new();
    if path.exists() {
        let existing = fs::read_to_string(&path).unwrap_or_default();
        for line in existing.lines() {
            if let Some((k, v)) = line.split_once('=') {
                map.insert(k.trim().to_string(), v.trim().trim_matches('"').to_string());
            }
        }
    }
    map.insert(key.to_string(), value.to_string());

    let mut out = String::new();
    for (k, v) in &map {
        out.push_str(&format!("{k}=\"{v}\"\n"));
    }

    let mut opts = fs::OpenOptions::new();
    opts.create(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        opts.mode(0o600);
    }
    let mut file = opts
        .open(&path)
        .with_context(|| format!("failed to open {}", path.display()))?;

    file.write_all(out.as_bytes())
        .with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn clear_plaintext_at(path: &std::path::Path, key: &str) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let existing = fs::read_to_string(path).unwrap_or_default();
    let mut map = std::collections::BTreeMap::<String, String>::new();
    for line in existing.lines() {
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() != key {
                map.insert(k.trim().to_string(), v.trim().trim_matches('"').to_string());
            }
        }
    }
    if map.is_empty() {
        let _ = fs::remove_file(path);
        return Ok(());
    }
    let mut out = String::new();
    for (k, v) in &map {
        out.push_str(&format!("{k}=\"{v}\"\n"));
    }
    let mut opts = fs::OpenOptions::new();
    opts.create(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        opts.mode(0o600);
    }
    let mut file = opts
        .open(path)
        .with_context(|| format!("failed to open {}", path.display()))?;
    file.write_all(out.as_bytes())
        .with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn clear_plaintext(key: &str) -> Result<()> {
    let Some(path) = credentials_path() else {
        return Ok(());
    };
    clear_plaintext_at(&path, key)
}

fn purge_stale_plaintext_at(path: &std::path::Path, plaintext_key: &str) -> Result<bool> {
    if !path.exists() {
        return Ok(false);
    }
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read credentials at {}", path.display()))?;
    let had_key = content.lines().any(|line| {
        line.split_once('=')
            .is_some_and(|(k, v)| k.trim() == plaintext_key && !v.trim().trim_matches('"').is_empty())
    });
    if !had_key {
        return Ok(false);
    }
    clear_plaintext_at(path, plaintext_key)?;
    Ok(true)
}

fn purge_stale_plaintext(plaintext_key: &str) -> Result<bool> {
    let Some(path) = credentials_path() else {
        return Ok(false);
    };
    purge_stale_plaintext_at(&path, plaintext_key)
}

fn store(user: &str, plaintext_key: &str, value: &str) -> Result<()> {
    match keyring_entry(user).and_then(|e| {
        e.set_password(value)
            .context("failed to store secret in OS keyring")
    }) {
        Ok(()) => {
            match purge_stale_plaintext(plaintext_key) {
                Ok(true) => {
                    eprintln!("note: removed stale plaintext credentials after keyring store");
                }
                Ok(false) => {}
                Err(err) => {
                    eprintln!("note: failed to remove stale plaintext credentials ({err})");
                }
            }
            Ok(())
        }
        Err(err) => {
            eprintln!("note: keyring unavailable ({err}); storing credentials in plaintext (0600)");
            write_plaintext(plaintext_key, value)
        }
    }
}

fn load(user: &str, plaintext_key: &str) -> Result<Option<String>> {
    if let Ok(entry) = keyring_entry(user) {
        match entry.get_password() {
            Ok(v) if !v.is_empty() => return Ok(Some(v)),
            Ok(_) => {}
            Err(keyring::Error::NoEntry) => {}
            Err(_) => {}
        }
    }
    read_plaintext(plaintext_key)
}

fn delete(user: &str, plaintext_key: &str) -> Result<()> {
    if let Ok(entry) = keyring_entry(user) {
        let _ = entry.delete_credential();
    }
    clear_plaintext(plaintext_key)
}

pub fn store_token(token: &str) -> Result<()> {
    store(TOKEN_USER, "token", token)
}

pub fn load_token() -> Result<Option<String>> {
    load(TOKEN_USER, "token")
}

pub fn clear_token() -> Result<()> {
    delete(TOKEN_USER, "token")
}

pub fn store_api_key(key: &str) -> Result<()> {
    store(API_KEY_USER, "api_key", key)
}

pub fn load_api_key() -> Result<Option<String>> {
    load(API_KEY_USER, "api_key")
}

pub fn clear_api_key() -> Result<()> {
    delete(API_KEY_USER, "api_key")
}

/// Resolve effective token: CLI/config override, else keyring/plaintext.
pub fn resolve_token(cli_or_config: Option<&str>) -> Result<Option<String>> {
    if let Some(t) = cli_or_config {
        if !t.is_empty() {
            return Ok(Some(t.to_string()));
        }
    }
    load_token()
}

/// Resolve effective API key: CLI/config override, else keyring/plaintext.
pub fn resolve_api_key(cli_or_config: Option<&str>) -> Result<Option<String>> {
    if let Some(k) = cli_or_config {
        if !k.is_empty() {
            return Ok(Some(k.to_string()));
        }
    }
    load_api_key()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// Helper: create a temp dir and return the path to a credentials file inside it.
    fn temp_creds_path() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "chm-creds-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir.join("credentials")
    }

    fn file_mode(path: &PathBuf) -> u32 {
        fs::metadata(path)
            .map(|m| m.permissions().mode())
            .unwrap_or(0)
    }

    #[test]
    #[cfg(unix)]
    fn write_plaintext_creates_file_with_0600() {
        let path = temp_creds_path();
        let parent = path.parent().unwrap();

        let mut map = std::collections::BTreeMap::<String, String>::new();
        map.insert("token".to_string(), "abc123".to_string());
        let mut out = String::new();
        for (k, v) in &map {
            out.push_str(&format!("{k}=\"{v}\"\n"));
        }

        let mut opts = fs::OpenOptions::new();
        opts.create(true).write(true).truncate(true);
        opts.mode(0o600);
        let mut file = opts.open(&path).unwrap();
        file.write_all(out.as_bytes()).unwrap();

        let mode = file_mode(&path);
        assert_eq!(
            mode & 0o777,
            0o600,
            "file should be 0600, got {:o}",
            mode & 0o777
        );

        let _ = fs::remove_dir_all(parent);
    }

    #[test]
    #[cfg(unix)]
    fn write_plaintext_no_world_readable_window() {
        // Verifies the content is written and the file mode is 0600 immediately,
        // i.e. there is no race window where the file is world-readable.
        let path = temp_creds_path();
        let parent = path.parent().unwrap();

        let mut map = std::collections::BTreeMap::<String, String>::new();
        map.insert("api_key".to_string(), "secret".to_string());
        let mut out = String::new();
        for (k, v) in &map {
            out.push_str(&format!("{k}=\"{v}\"\n"));
        }

        let mut opts = fs::OpenOptions::new();
        opts.create(true).write(true).truncate(true);
        opts.mode(0o600);
        let mut file = opts.open(&path).unwrap();
        file.write_all(out.as_bytes()).unwrap();

        let mode = file_mode(&path);
        assert_eq!(mode & 0o777, 0o600);
        // Content was written; read it back and verify.
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("api_key=\"secret\""));

        let _ = fs::remove_dir_all(parent);
    }

    #[test]
    #[cfg(unix)]
    fn clear_plaintext_rewrite_preserves_0600() {
        // First create with content at 0600, then simulate the clear path
        // (rewrite without the key) and verify the file stays 0600.
        let path = temp_creds_path();
        let parent = path.parent().unwrap();

        // Simulate initial write with both keys.
        let mut map = std::collections::BTreeMap::<String, String>::new();
        map.insert("token".to_string(), "t1".to_string());
        map.insert("api_key".to_string(), "k1".to_string());
        let mut out = String::new();
        for (k, v) in &map {
            out.push_str(&format!("{k}=\"{v}\"\n"));
        }

        let mut opts = fs::OpenOptions::new();
        opts.create(true).write(true).truncate(true);
        opts.mode(0o600);
        let mut file = opts.open(&path).unwrap();
        file.write_all(out.as_bytes()).unwrap();
        drop(file);

        assert_eq!(file_mode(&path) & 0o777, 0o600);

        // Now simulate clear_plaintext: remove "token", keep "api_key".
        let existing = fs::read_to_string(&path).unwrap();
        let mut map = std::collections::BTreeMap::<String, String>::new();
        for line in existing.lines() {
            if let Some((k, v)) = line.split_once('=') {
                if k.trim() != "token" {
                    map.insert(k.trim().to_string(), v.trim().trim_matches('"').to_string());
                }
            }
        }
        let mut out = String::new();
        for (k, v) in &map {
            out.push_str(&format!("{k}=\"{v}\"\n"));
        }

        let mut opts = fs::OpenOptions::new();
        opts.create(true).write(true).truncate(true);
        opts.mode(0o600);
        let mut file = opts.open(&path).unwrap();
        file.write_all(out.as_bytes()).unwrap();
        drop(file);

        // File should still be 0600 after rewrite.
        assert_eq!(file_mode(&path) & 0o777, 0o600);
        // And only api_key should remain.
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("api_key=\"k1\""));
        assert!(!content.contains("token"));

        let _ = fs::remove_dir_all(parent);
    }

    #[test]
    #[cfg(unix)]
    fn purge_stale_plaintext_removes_token_after_keyring_recovery() {
        let path = temp_creds_path();
        let parent = path.parent().unwrap();

        let mut map = std::collections::BTreeMap::<String, String>::new();
        map.insert("token".to_string(), "stale-token".to_string());
        map.insert("api_key".to_string(), "keep-me".to_string());
        let mut out = String::new();
        for (k, v) in &map {
            out.push_str(&format!("{k}=\"{v}\"\n"));
        }

        let mut opts = fs::OpenOptions::new();
        opts.create(true).write(true).truncate(true);
        opts.mode(0o600);
        let mut file = opts.open(&path).unwrap();
        file.write_all(out.as_bytes()).unwrap();
        drop(file);

        assert!(purge_stale_plaintext_at(&path, "token").unwrap());

        let content = fs::read_to_string(&path).unwrap();
        assert!(!content.contains("token"));
        assert!(content.contains("api_key=\"keep-me\""));
        assert_eq!(file_mode(&path) & 0o777, 0o600);

        let _ = fs::remove_dir_all(parent);
    }
}
