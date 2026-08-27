//! Local named database connections (`chm add` / `ls` / `use` / `rm`).
//!
//! Metadata lives in user config (`~/.config/chm/config.toml`). Passwords go
//! through the credentials helper (OS keyring with 0600 plaintext fallback)
//! and are never printed by `ls` or JSON. Distinct from dashboard `chm hosts`.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::{
    config::{self, FileConfig},
    credentials, diagnose,
};

const DEFAULT_CH_HTTP_PORT: u16 = 8123;
const DEFAULT_CH_HTTPS_PORT: u16 = 8443;
const DEFAULT_PG_PORT: u16 = 5432;
const CH_URL_SCHEME: &str = "clickhouse://"; // pragma: allowlist secret

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    ClickHouse, // pragma: allowlist secret
    Postgres,
}

impl Engine {
    pub fn as_str(self) -> &'static str {
        match self {
            Engine::ClickHouse => "clickhouse", // pragma: allowlist secret
            Engine::Postgres => "postgres",
        }
    }
}

impl std::fmt::Display for Engine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Saved connection metadata. Never contains a password.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredConnection {
    pub name: String,
    pub engine: Engine,
    pub host: String,
    pub port: u16,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub user: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub database: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub tls: bool,
}

impl StoredConnection {
    pub fn display_host(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    pub fn to_ch_config(&self, password: &str) -> Option<diagnose::ChConfig> {
        match self.engine {
            Engine::ClickHouse /* pragma: allowlist secret */ => {
                let scheme = if self.tls { "https" } else { "http" };
                Some(diagnose::ChConfig {
                    url: format!("{scheme}://{}:{}", self.host, self.port),
                    user: if self.user.is_empty() {
                        "default".into()
                    } else {
                        self.user.clone()
                    },
                    password: password.to_string(),
                    database: if self.database.is_empty() {
                        "default".into()
                    } else {
                        self.database.clone()
                    },
                })
            }
            Engine::Postgres => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedUrl {
    pub engine: Engine,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    pub tls: bool,
    pub user_in_url: bool,
    pub password_in_url: bool,
    pub database_in_url: bool,
}

#[derive(Debug, Clone)]
pub struct AddOutcome {
    pub name: String,
    pub replacing: bool,
    pub current: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ConnectionStore {
    pub config_path: PathBuf,
    pub credentials_path: PathBuf,
    pub use_keyring: bool,
}

impl ConnectionStore {
    pub fn from_config_path(config_path: PathBuf) -> Self {
        let parent = config_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        let credentials_path = parent.join("credentials");
        let use_keyring = config::user_config_dir().is_some_and(|d| d == parent);
        Self {
            config_path,
            credentials_path,
            use_keyring,
        }
    }

    pub fn load(&self) -> Result<(Vec<StoredConnection>, Option<String>)> {
        let file = config::load_user_file_config(&self.config_path)?;
        Ok((file.connections, file.current_connection))
    }

    fn save_file(&self, file: &FileConfig) -> Result<()> {
        config::save_user_config(&self.config_path, file)
    }

    pub fn add(&self, parsed: ParsedUrl, name: Option<&str>) -> Result<AddOutcome> {
        let mut file = config::load_user_file_config(&self.config_path)?;
        let derived = derive_name(&parsed);
        let name = match name {
            Some(raw) => parse_explicit_name(raw)?,
            None => uniquify_derived(&derived, &parsed, &file.connections),
        };
        let replacing = file.connections.iter().any(|c| c.name == name);
        let conn = StoredConnection {
            name: name.clone(),
            engine: parsed.engine,
            host: parsed.host.clone(),
            port: parsed.port,
            user: parsed.user.clone(),
            database: parsed.database.clone(),
            tls: parsed.tls,
        };
        file.connections.retain(|c| c.name != name);
        file.connections.push(conn);
        file.connections.sort_by(|a, b| a.name.cmp(&b.name));
        if file
            .current_connection
            .as_ref()
            .is_none_or(|c| c.trim().is_empty())
        {
            file.current_connection = Some(name.clone());
        }
        self.save_file(&file)?;
        if !parsed.password.is_empty() {
            credentials::store_connection_password_at(
                &self.credentials_path,
                &name,
                &parsed.password,
                self.use_keyring,
            )?;
        }
        Ok(AddOutcome {
            name,
            replacing,
            current: file.current_connection,
        })
    }

    pub fn use_name(&self, name: &str) -> Result<StoredConnection> {
        let mut file = config::load_user_file_config(&self.config_path)?;
        let conn = find_connection(&file.connections, name)?.clone();
        file.current_connection = Some(conn.name.clone());
        self.save_file(&file)?;
        Ok(conn)
    }

    pub fn remove(&self, name: &str) -> Result<StoredConnection> {
        let mut file = config::load_user_file_config(&self.config_path)?;
        let conn = find_connection(&file.connections, name)?.clone();
        file.connections.retain(|c| !eq_name(&c.name, &conn.name));
        if file
            .current_connection
            .as_ref()
            .is_some_and(|c| eq_name(c, &conn.name))
        {
            file.current_connection = file.connections.first().map(|c| c.name.clone());
        }
        self.save_file(&file)?;
        let _ = credentials::clear_connection_password_at(
            &self.credentials_path,
            &conn.name,
            self.use_keyring,
        );
        Ok(conn)
    }

    pub fn load_password(&self, name: &str) -> Result<Option<String>> {
        credentials::load_connection_password_at(&self.credentials_path, name, self.use_keyring)
    }

    pub fn ch_config_for(&self, name: &str) -> Result<Option<diagnose::ChConfig>> {
        let (conns, _) = self.load()?;
        let conn = find_connection(&conns, name)?;
        let password = self.load_password(&conn.name)?.unwrap_or_default();
        Ok(conn.to_ch_config(&password))
    }
}

fn eq_name(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

fn find_connection<'a>(conns: &'a [StoredConnection], name: &str) -> Result<&'a StoredConnection> {
    if let Some(c) = conns.iter().find(|c| eq_name(&c.name, name)) {
        return Ok(c);
    }
    let names: Vec<_> = conns.iter().map(|c| c.name.as_str()).collect();
    if names.is_empty() {
        bail!("unknown connection '{name}'. No local connections — run `chm add <url>`.");
    }
    bail!(
        "unknown connection '{name}'. Available: {}",
        names.join(", ")
    )
}

pub fn parse_connection_url(raw: &str) -> Result<ParsedUrl> {
    let raw = raw.trim();
    if raw.is_empty() {
        bail!("connection URL must not be empty");
    }
    let lower = raw.to_ascii_lowercase();
    if lower.starts_with("postgres://") || lower.starts_with("postgresql://") {
        parse_postgres_url(raw)
    } else if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with(CH_URL_SCHEME)
    // pragma: allowlist secret
    {
        parse_ch_url(raw) // pragma: allowlist secret
    } else if lower.contains("://") {
        let scheme = raw.split("://").next().unwrap_or(raw);
        bail!("unsupported URL scheme '{scheme}' (use http(s):// or postgres://)");
    } else {
        parse_ch_host(raw) // pragma: allowlist secret
    }
}

fn parse_postgres_url(raw: &str) -> Result<ParsedUrl> {
    let parsed = parse_scheme_url(raw)?;
    let tls = postgres_tls_from_query(&parsed.query);
    Ok(ParsedUrl {
        engine: Engine::Postgres,
        host: parsed.host,
        port: parsed.port.unwrap_or(DEFAULT_PG_PORT),
        user: parsed.user.clone(),
        password: parsed.password,
        database: parsed.database.clone(),
        tls,
        user_in_url: !parsed.user.is_empty(),
        password_in_url: parsed.password_in_url,
        database_in_url: !parsed.database.is_empty(),
    })
}

fn postgres_tls_from_query(query: &str) -> bool {
    for pair in query.split('&').filter(|p| !p.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = percent_decode(key);
        let value = percent_decode(value);
        if key.eq_ignore_ascii_case("sslmode") {
            let v = value.to_ascii_lowercase();
            return matches!(v.as_str(), "require" | "verify-ca" | "verify-full");
        }
        if key.eq_ignore_ascii_case("ssl") {
            return value.eq_ignore_ascii_case("true") || value == "1";
        }
    }
    false
}

fn parse_ch_url(raw: &str) -> Result<ParsedUrl> {
    // pragma: allowlist secret
    let normalized = if raw.to_ascii_lowercase().starts_with(CH_URL_SCHEME) {
        // pragma: allowlist secret
        format!(
            "http://{}",
            raw.split_once("://").map(|s| s.1).unwrap_or(raw)
        )
    } else {
        raw.to_string()
    };
    let parsed =
        parse_scheme_url(&normalized).with_context(|| format!("invalid ClickHouse URL '{raw}'"))?; // pragma: allowlist secret
    let tls = parsed.scheme == "https";
    let port = parsed.port.unwrap_or(if tls {
        DEFAULT_CH_HTTPS_PORT
    } else {
        DEFAULT_CH_HTTP_PORT
    });
    Ok(ParsedUrl {
        engine: Engine::ClickHouse, // pragma: allowlist secret
        host: parsed.host,
        port,
        user: parsed.user.clone(),
        password: parsed.password,
        database: parsed.database.clone(),
        tls,
        user_in_url: !parsed.user.is_empty(),
        password_in_url: parsed.password_in_url,
        database_in_url: !parsed.database.is_empty(),
    })
}

struct SchemeUrl {
    scheme: String,
    host: String,
    port: Option<u16>,
    user: String,
    password: String,
    password_in_url: bool,
    database: String,
    query: String,
}

fn parse_scheme_url(raw: &str) -> Result<SchemeUrl> {
    let Some((scheme, rest)) = raw.split_once("://") else {
        bail!("invalid URL '{raw}'");
    };
    let scheme = scheme.to_ascii_lowercase();
    let (rest, query) = match rest.split_once('?') {
        Some((r, q)) => (r, q.split('#').next().unwrap_or(q).to_string()),
        None => (rest.split('#').next().unwrap_or(rest), String::new()),
    };
    let (auth_host, path) = match rest.split_once('/') {
        Some((h, p)) => (h, p),
        None => (rest, ""),
    };
    if auth_host.is_empty() {
        bail!("URL is missing a host");
    }
    let (userinfo, hostport) = match auth_host.rsplit_once('@') {
        Some((u, h)) => (Some(u), h),
        None => (None, auth_host),
    };
    let (host, port) = split_host_port_opt(hostport)?;
    if host.is_empty() {
        bail!("URL is missing a host");
    }
    let mut user = String::new();
    let mut password = String::new();
    let mut password_in_url = false;
    if let Some(userinfo) = userinfo {
        match userinfo.split_once(':') {
            Some((u, p)) => {
                user = percent_decode(u);
                password = percent_decode(p);
                password_in_url = true;
            }
            None => {
                user = percent_decode(userinfo);
            }
        }
    }
    let database = path.split('/').next().unwrap_or("").to_string();
    let database = percent_decode(&database);
    Ok(SchemeUrl {
        scheme,
        host,
        port,
        user,
        password,
        password_in_url,
        database,
        query,
    })
}

fn split_host_port_opt(hostport: &str) -> Result<(String, Option<u16>)> {
    if let Some(rest) = hostport.strip_prefix('[') {
        let Some((host, after)) = rest.split_once(']') else {
            bail!("invalid IPv6 host '{hostport}'");
        };
        if after.is_empty() {
            return Ok((host.to_string(), None));
        }
        let Some(port_str) = after.strip_prefix(':') else {
            bail!("invalid IPv6 host '{hostport}'");
        };
        let port: u16 = port_str
            .parse()
            .with_context(|| format!("invalid port '{port_str}'"))?;
        return Ok((host.to_string(), Some(port)));
    }
    if let Some((host, port_str)) = hostport.rsplit_once(':') {
        if !host.is_empty() && port_str.chars().all(|c| c.is_ascii_digit()) && !port_str.is_empty()
        {
            let port: u16 = port_str
                .parse()
                .with_context(|| format!("invalid port '{port_str}'"))?;
            return Ok((host.to_string(), Some(port)));
        }
    }
    Ok((hostport.to_string(), None))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = bytes[i + 1];
            let lo = bytes[i + 2];
            if let (Some(h), Some(l)) = (from_hex(hi), from_hex(lo)) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn from_hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// `--ch-host` style: `host`, `host:port`, `host:port/db`, `host/db`.
fn parse_ch_host(raw: &str) -> Result<ParsedUrl> {
    // pragma: allowlist secret
    let raw = raw.trim().trim_end_matches('/');
    let (hostport, db) = match raw.split_once('/') {
        Some((h, d)) => (h, Some(d)),
        None => (raw, None),
    };
    if hostport.is_empty() {
        bail!("ClickHouse host must not be empty"); // pragma: allowlist secret
    }
    let (host, port) = split_host_port(hostport, DEFAULT_CH_HTTP_PORT)?;
    let database_in_url = db.is_some_and(|d| !d.is_empty());
    let database = db.unwrap_or("").to_string();
    Ok(ParsedUrl {
        engine: Engine::ClickHouse, // pragma: allowlist secret
        host,
        port,
        user: String::new(),
        password: String::new(),
        database,
        tls: false,
        user_in_url: false,
        password_in_url: false,
        database_in_url,
    })
}

fn split_host_port(hostport: &str, default_port: u16) -> Result<(String, u16)> {
    if let Some(rest) = hostport.strip_prefix('[') {
        let Some((host, after)) = rest.split_once(']') else {
            bail!("invalid IPv6 host '{hostport}'");
        };
        if after.is_empty() {
            return Ok((host.to_string(), default_port));
        }
        let Some(port_str) = after.strip_prefix(':') else {
            bail!("invalid IPv6 host '{hostport}'");
        };
        let port: u16 = port_str
            .parse()
            .with_context(|| format!("invalid port '{port_str}'"))?;
        return Ok((host.to_string(), port));
    }
    if let Some((host, port_str)) = hostport.rsplit_once(':') {
        if !host.is_empty() && port_str.chars().all(|c| c.is_ascii_digit()) && !port_str.is_empty()
        {
            let port: u16 = port_str
                .parse()
                .with_context(|| format!("invalid port '{port_str}'"))?;
            return Ok((host.to_string(), port));
        }
    }
    Ok((hostport.to_string(), default_port))
}

pub fn apply_ch_args(
    // pragma: allowlist secret
    parsed: &mut ParsedUrl,
    user: &str,
    password: &str,
    database: &str,
) {
    if !matches!(
        parsed.engine,
        Engine::ClickHouse /* pragma: allowlist secret */
    ) {
        return;
    }
    if !parsed.user_in_url && !user.is_empty() {
        parsed.user = user.to_string();
    }
    if !parsed.password_in_url && !password.is_empty() {
        parsed.password = password.to_string();
    }
    if !parsed.database_in_url && !database.is_empty() {
        parsed.database = database.to_string();
    }
}

pub fn sanitize_name(raw: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for c in raw.trim().chars() {
        let c = c.to_ascii_lowercase();
        let ok = c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-';
        if ok {
            out.push(c);
            last_dash = c == '-';
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    while out.starts_with('-') {
        out.remove(0);
    }
    if out.len() > 48 {
        out.truncate(48);
        while out.ends_with('-') {
            out.pop();
        }
    }
    out
}

pub fn parse_explicit_name(raw: &str) -> Result<String> {
    let name = sanitize_name(raw);
    if name.is_empty() {
        bail!("connection name must contain a letter or digit");
    }
    Ok(name)
}

pub fn derive_name(parsed: &ParsedUrl) -> String {
    let host = host_label(&parsed.host);
    let db = parsed.database.trim();
    let skip_db =
        db.is_empty() || db.eq_ignore_ascii_case("default") || db.eq_ignore_ascii_case("postgres");
    let base = if skip_db {
        host
    } else {
        format!("{host}-{}", sanitize_name(db))
    };
    let name = sanitize_name(&base);
    if name.is_empty() {
        "db".into()
    } else {
        name
    }
}

fn host_label(host: &str) -> String {
    if host == "127.0.0.1" || host == "::1" || host.eq_ignore_ascii_case("localhost") {
        return "localhost".into();
    }
    host.split('.').next().unwrap_or(host).to_string()
}

fn uniquify_derived(derived: &str, parsed: &ParsedUrl, existing: &[StoredConnection]) -> String {
    if let Some(c) = existing.iter().find(|c| c.name == derived) {
        if c.engine == parsed.engine && c.host == parsed.host && c.port == parsed.port {
            return derived.to_string();
        }
    } else {
        return derived.to_string();
    }
    for i in 2..1000 {
        let candidate = format!("{derived}-{i}");
        if !existing.iter().any(|c| c.name == candidate) {
            return candidate;
        }
    }
    format!("{derived}-new")
}

pub fn list_json(connections: &[StoredConnection], current: Option<&str>) -> serde_json::Value {
    let current_name = current.map(str::trim).filter(|s| !s.is_empty());
    serde_json::json!({
        "current": current_name,
        "connections": connections.iter().map(|c| {
            let is_current = current_name.is_some_and(|n| eq_name(n, &c.name));
            serde_json::json!({
                "name": c.name,
                "engine": c.engine.as_str(),
                "host": c.display_host(),
                "user": c.user,
                "database": c.database,
                "tls": c.tls,
                "current": is_current,
            })
        }).collect::<Vec<_>>(),
    })
}

pub fn format_list_text(connections: &[StoredConnection], current: Option<&str>) -> String {
    if connections.is_empty() {
        return "no local connections\nhint: chm add http://localhost:8123\n".into();
    }
    let current_name = current.map(str::trim).filter(|s| !s.is_empty());
    let mut out = String::new();
    for c in connections {
        let marker = if current_name.is_some_and(|n| eq_name(n, &c.name)) {
            "*"
        } else {
            " "
        };
        out.push_str(&format!(
            "{marker} {:<16} {:<11} {}\n",
            c.name,
            c.engine.as_str(),
            c.display_host()
        ));
    }
    out
}

pub fn picker_labels(connections: &[StoredConnection], current: Option<&str>) -> Vec<String> {
    let current_name = current.map(str::trim).filter(|s| !s.is_empty());
    connections
        .iter()
        .map(|c| {
            let marker = if current_name.is_some_and(|n| eq_name(n, &c.name)) {
                "*"
            } else {
                " "
            };
            format!(
                "{marker} {}  {}  {}",
                c.name,
                c.engine.as_str(),
                c.display_host()
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_store() -> (PathBuf, ConnectionStore) {
        let dir = std::env::temp_dir().join(format!(
            "chm-conn-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let store = ConnectionStore::from_config_path(dir.join("config.toml"));
        assert!(
            !store.use_keyring,
            "temp config dir must not use the OS keyring"
        );
        (dir, store)
    }

    #[test]
    fn parse_ch_http_with_userinfo_and_db() {
        // pragma: allowlist secret
        let p = parse_connection_url("http://alice:s3cret@ch.example.com:8123/analytics").unwrap();
        assert_eq!(p.engine, Engine::ClickHouse); // pragma: allowlist secret
        assert_eq!(p.host, "ch.example.com");
        assert_eq!(p.port, 8123);
        assert_eq!(p.user, "alice");
        assert_eq!(p.password, "s3cret");
        assert_eq!(p.database, "analytics");
        assert!(!p.tls);
        assert!(p.user_in_url && p.password_in_url && p.database_in_url);
        assert_eq!(derive_name(&p), "ch-analytics");
    }

    #[test]
    fn parse_ch_https_default_port() {
        // pragma: allowlist secret
        let p = parse_connection_url("https://secure.example").unwrap();
        assert_eq!(p.port, 8443);
        assert!(p.tls);
        assert_eq!(p.host, "secure.example");
        assert!(!p.user_in_url);
    }

    #[test]
    fn parse_ch_host_style() {
        // pragma: allowlist secret
        let p = parse_connection_url("localhost:8123").unwrap();
        assert_eq!(p.engine, Engine::ClickHouse); // pragma: allowlist secret
        assert_eq!(p.host, "localhost");
        assert_eq!(p.port, 8123);
        assert!(!p.tls);
        assert_eq!(derive_name(&p), "localhost");

        let with_db = parse_connection_url("127.0.0.1:8443/metrics").unwrap();
        assert_eq!(with_db.host, "127.0.0.1");
        assert_eq!(with_db.port, 8443);
        assert_eq!(with_db.database, "metrics");
        assert_eq!(derive_name(&with_db), "localhost-metrics");
    }

    #[test]
    fn parse_ch_percent_encoded_password() {
        // pragma: allowlist secret
        let p = parse_connection_url("http://u:p%40ss@localhost:8123").unwrap();
        assert_eq!(p.password, "p@ss");
    }

    #[test]
    fn parse_postgres_url() {
        let p = parse_connection_url("postgres://bob:p%40ss@db.example:5432/app").unwrap();
        assert_eq!(p.engine, Engine::Postgres);
        assert_eq!(p.host, "db.example");
        assert_eq!(p.port, 5432);
        assert_eq!(p.user, "bob");
        assert_eq!(p.password, "p@ss");
        assert_eq!(p.database, "app");
        assert!(!p.tls);
        assert_eq!(derive_name(&p), "db-app");
    }

    #[test]
    fn parse_postgresql_sslmode_require() {
        let p = parse_connection_url("postgresql://localhost/app?sslmode=require").unwrap();
        assert_eq!(p.engine, Engine::Postgres);
        assert_eq!(p.host, "localhost");
        assert_eq!(p.port, 5432);
        assert_eq!(p.database, "app");
        assert!(p.tls);
        assert_eq!(derive_name(&p), "localhost-app");
    }

    #[test]
    fn reject_unknown_scheme() {
        let err = parse_connection_url("ftp://localhost/db").unwrap_err();
        assert!(err.to_string().contains("unsupported URL scheme"), "{err}");
    }

    #[test]
    fn add_use_ls_rm_on_temp_config_hides_secrets() {
        let (dir, store) = temp_store();
        let mut parsed =
            parse_connection_url("http://alice:super-secret@localhost:8123/default").unwrap();
        apply_ch_args(&mut parsed, "ignored", "", "ignored"); // pragma: allowlist secret
        assert_eq!(parsed.user, "alice");
        assert_eq!(parsed.password, "super-secret");

        let added = store.add(parsed, None).unwrap();
        assert_eq!(added.name, "localhost");
        assert!(!added.replacing);
        assert_eq!(added.current.as_deref(), Some("localhost"));

        let pg = parse_connection_url("postgres://app:pg-secret@localhost:5432/orders").unwrap();
        let pg_added = store.add(pg, Some("shop")).unwrap();
        assert_eq!(pg_added.name, "shop");
        assert_eq!(pg_added.current.as_deref(), Some("localhost"));

        let (conns, current) = store.load().unwrap();
        let text = format_list_text(&conns, current.as_deref());
        assert!(text.contains("* localhost"), "{text}");
        assert!(text.contains("clickhouse"), "{text}"); // pragma: allowlist secret
        assert!(text.contains("shop"), "{text}");
        assert!(text.contains("postgres"), "{text}");
        assert!(!text.contains("super-secret"), "{text}");
        assert!(!text.contains("pg-secret"), "{text}");

        let json = list_json(&conns, current.as_deref());
        let dumped = json.to_string();
        assert!(!dumped.contains("super-secret"), "{dumped}");
        assert!(!dumped.contains("pg-secret"), "{dumped}");
        assert!(!dumped.contains("password"), "{dumped}");
        assert_eq!(json["current"], "localhost");
        assert_eq!(json["connections"][0]["engine"], "clickhouse"); // pragma: allowlist secret
        assert_eq!(json["connections"][1]["name"], "shop");

        let toml = fs::read_to_string(&store.config_path).unwrap();
        assert!(!toml.contains("super-secret"), "{toml}");
        assert!(!toml.contains("pg-secret"), "{toml}");
        assert!(toml.contains("current_connection"), "{toml}");

        let creds = fs::read_to_string(&store.credentials_path).unwrap();
        assert!(creds.contains("super-secret"), "{creds}");
        assert!(creds.contains("pg-secret"), "{creds}");

        store.use_name("shop").unwrap();
        let (_, current) = store.load().unwrap();
        assert_eq!(current.as_deref(), Some("shop"));

        store.remove("shop").unwrap();
        let (conns, current) = store.load().unwrap();
        assert_eq!(conns.len(), 1);
        assert_eq!(current.as_deref(), Some("localhost"));
        let creds = fs::read_to_string(&store.credentials_path).unwrap();
        assert!(!creds.contains("pg-secret"), "{creds}");
        assert!(creds.contains("super-secret"), "{creds}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn add_uniquifies_conflicting_auto_names() {
        let (dir, store) = temp_store();
        store
            .add(parse_connection_url("http://localhost:8123").unwrap(), None)
            .unwrap();
        let second = store
            .add(parse_connection_url("http://localhost:8443").unwrap(), None)
            .unwrap();
        assert_eq!(second.name, "localhost-2");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ch_args_fill_host_style_url() {
        // pragma: allowlist secret
        let mut parsed = parse_connection_url("localhost:8123").unwrap();
        apply_ch_args(&mut parsed, "default", "from-flag", "analytics"); // pragma: allowlist secret
        assert_eq!(parsed.user, "default");
        assert_eq!(parsed.password, "from-flag");
        assert_eq!(parsed.database, "analytics");
    }

    #[test]
    fn to_ch_config_skips_postgres() {
        let conn = StoredConnection {
            name: "pg".into(),
            engine: Engine::Postgres,
            host: "localhost".into(),
            port: 5432,
            user: "app".into(),
            database: "app".into(),
            tls: false,
        };
        assert!(conn.to_ch_config("x").is_none());
    }
}
