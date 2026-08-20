//! Layered CLI configuration.
//!
//! Priority (highest wins): CLI flags → env → project (`chm.toml` / `.chm/config.toml`)
//! → user (`~/.config/chm/config.toml`) → built-in defaults.

use std::{env, fs, path::PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::cli::{Channel, Cli};

/// Cloud SaaS default — fail-open to the hosted product, not localhost.
pub const DEFAULT_BASE_URL: &str = "https://dash.chmonitor.dev";
pub const DEFAULT_HOST_ID: u32 = 0;
pub const DEFAULT_CHART: &str = "query-count";
pub const DEFAULT_CHANNEL: Channel = Channel::Stable;

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct FileConfig {
    pub base_url: Option<String>,
    pub host_id: Option<u32>,
    pub api_key: Option<String>,
    pub token: Option<String>,
    pub default_chart: Option<String>,
    pub channel: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub base_url: String,
    pub host_id: u32,
    pub api_key: Option<String>,
    pub token: Option<String>,
    pub default_chart: String,
    pub channel: Channel,
    pub json: bool,
    pub quiet: bool,
    pub yes: bool,
    pub debug: bool,
    /// Resolved user config path (may not exist yet).
    pub user_config_path: PathBuf,
}

pub fn user_config_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("chm")).or_else(|| {
        dirs::home_dir().map(|h| h.join(".config/chm"))
    })
}

pub fn user_config_path() -> Option<PathBuf> {
    user_config_dir().map(|d| d.join("config.toml"))
}

pub fn default_config_path() -> Option<PathBuf> {
    user_config_path()
}

fn project_config_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(cwd) = env::current_dir() {
        out.push(cwd.join("chm.toml"));
        out.push(cwd.join(".chm").join("config.toml"));
    }
    out
}

fn load_toml_file(path: &PathBuf) -> Result<Option<FileConfig>> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read config at {}", path.display()))?;
    let cfg = toml::from_str(&content)
        .with_context(|| format!("failed to parse config at {}", path.display()))?;
    Ok(Some(cfg))
}

fn load_file_config(explicit: Option<PathBuf>) -> Result<(FileConfig, PathBuf)> {
    let user_path = default_config_path().unwrap_or_else(|| PathBuf::from("config.toml"));

    if let Some(path) = explicit {
        let cfg = load_toml_file(&path)?.unwrap_or_default();
        return Ok((cfg, path));
    }

    // Layer: project over user (project fills gaps only when merging below).
    let mut merged = FileConfig::default();
    if let Some(user) = load_toml_file(&user_path)? {
        merge_file(&mut merged, user);
    }
    for candidate in project_config_candidates() {
        if let Some(project) = load_toml_file(&candidate)? {
            merge_file(&mut merged, project);
        }
    }
    Ok((merged, user_path))
}

fn merge_file(dst: &mut FileConfig, src: FileConfig) {
    if src.base_url.is_some() {
        dst.base_url = src.base_url;
    }
    if src.host_id.is_some() {
        dst.host_id = src.host_id;
    }
    if src.api_key.is_some() {
        dst.api_key = src.api_key;
    }
    if src.token.is_some() {
        dst.token = src.token;
    }
    if src.default_chart.is_some() {
        dst.default_chart = src.default_chart;
    }
    if src.channel.is_some() {
        dst.channel = src.channel;
    }
}

fn parse_channel(raw: &str) -> Result<Channel> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "stable" => Ok(Channel::Stable),
        "beta" => Ok(Channel::Beta),
        other => bail!("unknown channel '{other}' (expected stable|beta)"),
    }
}

pub fn resolve_config(cli: &Cli) -> Result<AppConfig> {
    let (file, user_config_path) = load_file_config(cli.config.clone())?;

    let channel = if let Some(c) = cli.channel {
        c
    } else if let Ok(env_ch) = env::var("CHM_CHANNEL") {
        if env_ch.is_empty() {
            file.channel
                .as_deref()
                .map(parse_channel)
                .transpose()?
                .unwrap_or(DEFAULT_CHANNEL)
        } else {
            parse_channel(&env_ch)?
        }
    } else {
        file.channel
            .as_deref()
            .map(parse_channel)
            .transpose()?
            .unwrap_or(DEFAULT_CHANNEL)
    };

    Ok(AppConfig {
        base_url: cli
            .base_url
            .clone()
            .or(file.base_url)
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string()),
        host_id: cli.host_id.or(file.host_id).unwrap_or(DEFAULT_HOST_ID),
        api_key: cli.api_key.clone().or(file.api_key),
        token: cli.token.clone().or(file.token),
        default_chart: file
            .default_chart
            .unwrap_or_else(|| DEFAULT_CHART.to_string()),
        channel,
        json: cli.json,
        quiet: cli.quiet,
        yes: cli.yes,
        debug: cli.debug,
        user_config_path,
    })
}

pub fn save_user_config(path: &PathBuf, cfg: &FileConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let content = toml::to_string_pretty(cfg).context("failed to serialize config")?;
    fs::write(path, content)
        .with_context(|| format!("failed to write config at {}", path.display()))?;
    Ok(())
}

pub fn load_user_file_config(path: &PathBuf) -> Result<FileConfig> {
    Ok(load_toml_file(path)?.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_base_url_is_cloud() {
        assert_eq!(DEFAULT_BASE_URL, "https://dash.chmonitor.dev");
        assert!(DEFAULT_BASE_URL.starts_with("https://"));
        assert!(!DEFAULT_BASE_URL.contains("localhost"));
    }
}
