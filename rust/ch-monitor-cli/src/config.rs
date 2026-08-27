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
pub const DEFAULT_TABLE: &str = "running-queries";
pub const DEFAULT_CHANNEL: Channel = Channel::Stable;

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct FileConfig {
    pub base_url: Option<String>,
    pub host_id: Option<u32>,
    pub api_key: Option<String>,
    pub token: Option<String>,
    pub default_chart: Option<String>,
    pub channel: Option<String>,
    /// Active local connection name (`chm use`). Not a dashboard host id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_connection: Option<String>,
    /// Local named connections (`chm add`). Passwords are not stored here.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub connections: Vec<crate::connections::StoredConnection>,
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
    dirs::config_dir()
        .map(|d| d.join("chm"))
        .or_else(|| dirs::home_dir().map(|h| h.join(".config/chm")))
}

pub fn user_config_path() -> Option<PathBuf> {
    user_config_dir().map(|d| d.join("config.toml"))
}

pub fn default_config_path() -> Option<PathBuf> {
    user_config_path()
}

pub fn project_config_paths_from(cwd: &std::path::Path) -> Vec<PathBuf> {
    vec![cwd.join("chm.toml"), cwd.join(".chm").join("config.toml")]
}

fn project_config_candidates() -> Vec<PathBuf> {
    env::current_dir()
        .map(|cwd| project_config_paths_from(&cwd))
        .unwrap_or_default()
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
    load_layered_files(user_path, project_config_candidates(), explicit)
}

/// Merge user then project (project wins among files). `--config` replaces both.
pub fn load_layered_files(
    user_path: PathBuf,
    project_paths: Vec<PathBuf>,
    explicit: Option<PathBuf>,
) -> Result<(FileConfig, PathBuf)> {
    if let Some(path) = explicit {
        let cfg = load_toml_file(&path)?.unwrap_or_default();
        return Ok((cfg, path));
    }

    // Layer: project over user (project wins when both set the same key).
    // Local connections stay on the user file only.
    let mut merged = FileConfig::default();
    if let Some(user) = load_toml_file(&user_path)? {
        merged.current_connection = user.current_connection.clone();
        merged.connections = user.connections.clone();
        merge_file(&mut merged, user);
    }
    for candidate in project_paths {
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
    // Local connections stay on the user (or --config) file. Project
    // chm.toml is dashboard settings and must not drop or replace them.
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

const SECRET_KEYS: &[&str] = &["api_key", "token", "password"];

/// Redact `api_key` / `token` / `password` values as `(set)` so `config show` is safe to print.
pub fn redact_toml(content: &str) -> String {
    let Ok(mut value) = toml::from_str::<toml::Value>(content) else {
        return content.to_string();
    };
    redact_value(&mut value);
    toml::to_string_pretty(&value).unwrap_or_else(|_| content.to_string())
}

fn redact_value(value: &mut toml::Value) {
    match value {
        toml::Value::Table(table) => {
            let keys: Vec<String> = table.keys().cloned().collect();
            for key in keys {
                if SECRET_KEYS.iter().any(|s| *s == key) {
                    if let Some(toml::Value::String(s)) = table.get(&key) {
                        if !s.is_empty() && s != "(set)" {
                            table.insert(key.clone(), toml::Value::String("(set)".into()));
                        }
                    }
                }
                if let Some(v) = table.get_mut(&key) {
                    redact_value(v);
                }
            }
        }
        toml::Value::Array(arr) => {
            for v in arr {
                redact_value(v);
            }
        }
        _ => {}
    }
}

#[derive(Debug, Clone)]
pub struct FileLayer {
    pub path: PathBuf,
    pub exists: bool,
    pub content: Option<String>,
}

impl FileLayer {
    pub fn load(path: PathBuf) -> Self {
        if !path.exists() {
            return Self {
                path,
                exists: false,
                content: None,
            };
        }
        match fs::read_to_string(&path) {
            Ok(raw) => Self {
                path,
                exists: true,
                content: Some(redact_toml(&raw)),
            },
            Err(err) => Self {
                path,
                exists: true,
                content: Some(format!("# failed to read: {err}")),
            },
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConfigOverride {
    pub key: String,
    pub value: String,
    pub source: String,
}

#[derive(Debug, Clone)]
pub struct ConfigSnapshot {
    pub user: FileLayer,
    pub projects: Vec<FileLayer>,
    pub explicit: Option<FileLayer>,
    pub overrides: Vec<ConfigOverride>,
    pub resolved: AppConfig,
}

fn args_have_flag(flag: &str) -> bool {
    env::args().any(|a| a == flag || a.starts_with(&format!("{flag}=")))
}

fn override_source(flag: &str, env_name: &str) -> String {
    let has_flag = args_have_flag(flag);
    let has_env = env::var_os(env_name).is_some_and(|v| !v.is_empty());
    match (has_flag, has_env) {
        (true, true) => format!("flag {flag} (env {env_name} also set)"),
        (true, false) => format!("flag {flag}"),
        (false, true) => format!("env {env_name}"),
        (false, false) => "flag/env".to_string(),
    }
}

pub fn collect_overrides(cli: &Cli) -> Vec<ConfigOverride> {
    let mut out = Vec::new();
    if let Some(v) = &cli.base_url {
        out.push(ConfigOverride {
            key: "base_url".into(),
            value: v.clone(),
            source: override_source("--base-url", "CHM_BASE_URL"),
        });
    }
    if let Some(v) = cli.host_id {
        out.push(ConfigOverride {
            key: "host_id".into(),
            value: v.to_string(),
            source: override_source("--host-id", "CHM_HOST_ID"),
        });
    }
    if cli.api_key.as_ref().is_some_and(|k| !k.is_empty()) {
        out.push(ConfigOverride {
            key: "api_key".into(),
            value: "(set)".into(),
            source: override_source("--api-key", "CHM_API_KEY"),
        });
    }
    if cli.token.as_ref().is_some_and(|t| !t.is_empty()) {
        out.push(ConfigOverride {
            key: "token".into(),
            value: "(set)".into(),
            source: override_source("--token", "CHM_TOKEN"),
        });
    }
    if let Some(ch) = cli.channel {
        out.push(ConfigOverride {
            key: "channel".into(),
            value: ch.as_str().to_string(),
            source: override_source("--channel", "CHM_CHANNEL"),
        });
    }
    if let Some(path) = &cli.config {
        out.push(ConfigOverride {
            key: "config".into(),
            value: path.display().to_string(),
            source: override_source("--config", "CHM_CONFIG"),
        });
    }
    out
}

pub fn snapshot_layers(
    cli: &Cli,
    cfg: &AppConfig,
    user_path: PathBuf,
    project_paths: Vec<PathBuf>,
) -> ConfigSnapshot {
    ConfigSnapshot {
        user: FileLayer::load(user_path),
        projects: project_paths.into_iter().map(FileLayer::load).collect(),
        explicit: cli.config.clone().map(FileLayer::load),
        overrides: collect_overrides(cli),
        resolved: cfg.clone(),
    }
}

pub fn current_snapshot(cli: &Cli, cfg: &AppConfig) -> ConfigSnapshot {
    let user_path =
        user_config_path().unwrap_or_else(|| PathBuf::from("~/.config/chm/config.toml"));
    snapshot_layers(cli, cfg, user_path, project_config_candidates())
}

pub fn format_snapshot_text(snap: &ConfigSnapshot) -> String {
    let mut out = String::new();
    out.push_str("# chm config\n");
    out.push_str("# Highest file layer wins among files (project over user).\n");
    out.push_str(
        "# Flags / env beat files. Built-in default base_url is https://dash.chmonitor.dev.\n\n",
    );

    out.push_str("## 1. User\n");
    push_layer(&mut out, &snap.user);

    out.push_str("\n## 2. Project\n");
    if snap.projects.is_empty() {
        out.push_str("(no project paths — cwd unavailable)\n");
    } else {
        for layer in &snap.projects {
            push_layer(&mut out, layer);
        }
    }

    if let Some(explicit) = &snap.explicit {
        out.push_str("\n## --config (replaces user + project file merge)\n");
        push_layer(&mut out, explicit);
    }

    out.push_str("\n## 3. Env / flags that overrode\n");
    if snap.overrides.is_empty() {
        out.push_str("(none)\n");
    } else {
        for ov in &snap.overrides {
            out.push_str(&format!("{} = {}  ({})\n", ov.key, ov.value, ov.source));
        }
    }

    out.push_str("\n## 4. Resolved (what the CLI uses)\n");
    let cfg = &snap.resolved;
    out.push_str(&format!("base_url        = {}\n", cfg.base_url));
    out.push_str(&format!("host_id         = {}\n", cfg.host_id));
    out.push_str(&format!(
        "api_key         = {}\n",
        if cfg.api_key.as_ref().is_some_and(|k| !k.is_empty()) {
            "(set)"
        } else {
            "(unset)"
        }
    ));
    out.push_str(&format!(
        "token           = {}\n",
        if cfg.token.as_ref().is_some_and(|t| !t.is_empty()) {
            "(set)"
        } else {
            "(unset)"
        }
    ));
    out.push_str(&format!("default_chart   = {}\n", cfg.default_chart));
    out.push_str(&format!("channel         = {}\n", cfg.channel));
    out.push_str(&format!(
        "user_config     = {}\n",
        cfg.user_config_path.display()
    ));
    out
}

fn push_layer(out: &mut String, layer: &FileLayer) {
    out.push_str(&format!("path: {}\n", layer.path.display()));
    out.push_str(&format!(
        "exists: {}\n",
        if layer.exists { "yes" } else { "no" }
    ));
    match &layer.content {
        Some(content) if !content.trim().is_empty() => {
            out.push_str("---\n");
            out.push_str(content);
            if !content.ends_with('\n') {
                out.push('\n');
            }
            out.push_str("---\n");
        }
        Some(_) | None if layer.exists => out.push_str("(empty file)\n"),
        _ => {}
    }
}

pub fn format_snapshot_json(snap: &ConfigSnapshot) -> serde_json::Value {
    let cfg = &snap.resolved;
    let layer_json = |layer: &FileLayer| {
        serde_json::json!({
            "path": layer.path.display().to_string(),
            "exists": layer.exists,
            "content": layer.content,
        })
    };
    serde_json::json!({
        "user": layer_json(&snap.user),
        "project": snap.projects.iter().map(layer_json).collect::<Vec<_>>(),
        "explicit": snap.explicit.as_ref().map(layer_json),
        "overrides": snap.overrides.iter().map(|o| serde_json::json!({
            "key": o.key,
            "value": o.value,
            "source": o.source,
        })).collect::<Vec<_>>(),
        "resolved": {
            "base_url": cfg.base_url,
            "host_id": cfg.host_id,
            "api_key_set": cfg.api_key.as_ref().is_some_and(|k| !k.is_empty()),
            "token_set": cfg.token.as_ref().is_some_and(|t| !t.is_empty()),
            "default_chart": cfg.default_chart,
            "channel": cfg.channel.as_str(),
            "user_config_path": cfg.user_config_path.display().to_string(),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn default_base_url_is_cloud() {
        assert_eq!(DEFAULT_BASE_URL, "https://dash.chmonitor.dev");
        assert!(DEFAULT_BASE_URL.starts_with("https://"));
        assert!(!DEFAULT_BASE_URL.contains("localhost"));
    }

    #[test]
    fn default_chart_and_table() {
        assert_eq!(DEFAULT_CHART, "query-count");
        assert_eq!(DEFAULT_TABLE, "running-queries");
    }

    #[test]
    fn redact_toml_hides_secrets() {
        let raw = r#"
base_url = "https://dash.chmonitor.dev"
api_key = "chm_secret"
token = "tok"
host_id = 1
"#;
        let redacted = redact_toml(raw);
        assert!(redacted.contains("chmonitor.dev"), "{redacted}");
        assert!(!redacted.contains("chm_secret"), "{redacted}");
        assert!(
            !redacted.contains("tok\n") && !redacted.contains("\"tok\""),
            "{redacted}"
        );
        assert!(redacted.contains("(set)"), "{redacted}");
        assert!(redacted.contains("host_id"), "{redacted}");
    }

    #[test]
    fn project_file_overrides_user_file() {
        let root = std::env::temp_dir().join(format!(
            "chm-cfg-merge-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let user = root.join("user.toml");
        let project = root.join("chm.toml");
        fs::write(&user, "host_id = 1\nbase_url = \"http://user.example\"\n").unwrap();
        fs::write(&project, "host_id = 2\n").unwrap();
        let (merged, path) = load_layered_files(user.clone(), vec![project], None).unwrap();
        assert_eq!(path, user);
        assert_eq!(merged.host_id, Some(2));
        assert_eq!(merged.base_url.as_deref(), Some("http://user.example"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn explicit_config_skips_user_and_project() {
        let root = std::env::temp_dir().join(format!(
            "chm-cfg-explicit-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let user = root.join("user.toml");
        let project = root.join("chm.toml");
        let explicit = root.join("explicit.toml");
        fs::write(&user, "host_id = 1\n").unwrap();
        fs::write(&project, "host_id = 2\n").unwrap();
        fs::write(&explicit, "host_id = 9\nbase_url = \"http://explicit\"\n").unwrap();
        let (merged, path) =
            load_layered_files(user, vec![project], Some(explicit.clone())).unwrap();
        assert_eq!(path, explicit);
        assert_eq!(merged.host_id, Some(9));
        assert_eq!(merged.base_url.as_deref(), Some("http://explicit"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn snapshot_prints_file_contents_and_resolved_default() {
        let root = std::env::temp_dir().join(format!(
            "chm-cfg-show-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let proj = root.join("proj");
        fs::create_dir_all(proj.join(".chm")).unwrap();
        let user = root.join("user.toml");
        fs::write(
            &user,
            "base_url = \"http://user\"\napi_key = \"secret-key\"\n",
        )
        .unwrap();
        let project = proj.join("chm.toml");
        fs::write(&project, "host_id = 3\n").unwrap();
        let nested = proj.join(".chm").join("config.toml");
        fs::write(&nested, "channel = \"beta\"\n").unwrap();

        let cfg = AppConfig {
            base_url: DEFAULT_BASE_URL.to_string(),
            host_id: 3,
            api_key: Some("secret-key".into()),
            token: None,
            default_chart: DEFAULT_CHART.to_string(),
            channel: Channel::Beta,
            json: false,
            quiet: false,
            yes: false,
            debug: false,
            user_config_path: user.clone(),
        };
        let cli = crate::cli::Cli::try_parse_from(["chm", "config", "show"]).unwrap();
        let snap = snapshot_layers(&cli, &cfg, user, vec![project, nested]);
        let text = format_snapshot_text(&snap);
        assert!(text.contains("## 1. User"), "{text}");
        assert!(text.contains("## 2. Project"), "{text}");
        assert!(text.contains("## 3. Env / flags"), "{text}");
        assert!(text.contains("## 4. Resolved"), "{text}");
        assert!(text.contains("http://user"), "{text}");
        assert!(!text.contains("secret-key"), "{text}");
        assert!(text.contains("(set)"), "{text}");
        assert!(text.contains("host_id = 3"), "{text}");
        assert!(
            text.contains("channel = \"beta\"") || text.contains("channel = 'beta'"),
            "{text}"
        );
        assert!(text.contains(DEFAULT_BASE_URL), "{text}");
        let json = format_snapshot_json(&snap);
        assert_eq!(json["resolved"]["host_id"], 3);
        assert_eq!(json["resolved"]["api_key_set"], true);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn project_merge_keeps_user_connections() {
        let root = std::env::temp_dir().join(format!(
            "chm-cfg-conns-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let user = root.join("user.toml");
        let project = root.join("chm.toml");
        fs::write(
            &user,
            r#"
current_connection = "local"

[[connections]]
name = "local"
engine = "clickhouse" # pragma: allowlist secret
host = "localhost"
port = 8123
"#,
        )
        .unwrap();
        fs::write(&project, "host_id = 2\n").unwrap();
        let (merged, _) = load_layered_files(user, vec![project], None).unwrap();
        assert_eq!(merged.host_id, Some(2));
        assert_eq!(merged.current_connection.as_deref(), Some("local"));
        assert_eq!(merged.connections.len(), 1);
        assert_eq!(merged.connections[0].name, "local");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn redact_toml_hides_nested_password() {
        let raw = r#"
[[connections]]
name = "local"
password = "should-not-print"
"#;
        let redacted = redact_toml(raw);
        assert!(!redacted.contains("should-not-print"), "{redacted}");
        assert!(redacted.contains("(set)"), "{redacted}");
    }
}
