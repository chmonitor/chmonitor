//! Credential storage: OS keyring with 0600 plaintext fallback.

use std::{fs, io::Write, path::PathBuf};

use anyhow::{Context, Result};
use keyring::Entry;

const SERVICE: &str = "chmonitor-chm";
const TOKEN_USER: &str = "token";
const API_KEY_USER: &str = "api-key";

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
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
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

    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .with_context(|| format!("failed to open {}", path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .with_context(|| format!("failed to chmod 0600 {}", path.display()))?;
    }

    file.write_all(out.as_bytes())
        .with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn clear_plaintext(key: &str) -> Result<()> {
    let Some(path) = credentials_path() else {
        return Ok(());
    };
    if !path.exists() {
        return Ok(());
    }
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mut map = std::collections::BTreeMap::<String, String>::new();
    for line in existing.lines() {
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() != key {
                map.insert(k.trim().to_string(), v.trim().trim_matches('"').to_string());
            }
        }
    }
    if map.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    let mut out = String::new();
    for (k, v) in &map {
        out.push_str(&format!("{k}=\"{v}\"\n"));
    }
    fs::write(&path, out)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn store(user: &str, plaintext_key: &str, value: &str) -> Result<()> {
    match keyring_entry(user).and_then(|e| {
        e.set_password(value)
            .context("failed to store secret in OS keyring")
    }) {
        Ok(()) => Ok(()),
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
