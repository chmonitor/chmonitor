//! `chm auth` — auto-detect dashboard auth mode, then login.

use std::io::{self, Write};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use indicatif::{ProgressBar, ProgressStyle};
use reqwest::Client;
use serde::Deserialize;
use serde_json::Value;

use crate::{
    cli::{AuthArgs, AuthCommand, AuthLoginArgs},
    client::apply_auth,
    config::AppConfig,
    credentials,
    output::{self, success},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliAuthMethod {
    None,
    Device,
    ApiKey,
}

impl CliAuthMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            CliAuthMethod::None => "none",
            CliAuthMethod::Device => "device",
            CliAuthMethod::ApiKey => "api_key",
        }
    }
}

#[derive(Debug, Clone)]
pub struct CliAuthDiscovery {
    pub method: CliAuthMethod,
    pub hint: String,
    pub device_enabled: bool,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[serde(default)]
    verification_uri_complete: Option<String>,
    #[serde(default = "default_interval")]
    interval: u64,
    #[serde(default = "default_expires")]
    expires_in: u64,
}

fn default_interval() -> u64 {
    5
}
fn default_expires() -> u64 {
    900
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

/// Parse `method` from discovery JSON (`none` | `device` | `api_key`).
pub fn parse_method(raw: &str) -> Option<CliAuthMethod> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "none" => Some(CliAuthMethod::None),
        "device" => Some(CliAuthMethod::Device),
        "api_key" | "apikey" | "api-key" => Some(CliAuthMethod::ApiKey),
        _ => None,
    }
}

/// Build discovery from a `/api/v1/auth/cli` (or fallback) JSON body.
pub fn discovery_from_json(value: &Value) -> Option<CliAuthDiscovery> {
    let root = value.get("data").unwrap_or(value);
    let method_raw = root.get("method")?.as_str()?;
    let method = parse_method(method_raw)?;
    let hint = root
        .get("hint")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let device_enabled = root
        .pointer("/deviceLogin/enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(method == CliAuthMethod::Device);
    Some(CliAuthDiscovery {
        method,
        hint,
        device_enabled,
    })
}

async fn discover(client: &Client, cfg: &AppConfig) -> Result<CliAuthDiscovery> {
    let base = cfg.base_url.trim_end_matches('/');
    let cli_url = format!("{base}/api/v1/auth/cli");

    let resp = client.get(&cli_url).send().await;
    if let Ok(resp) = resp {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if status.is_success() {
            let value: Value = serde_json::from_str(&text)
                .with_context(|| format!("unexpected auth/cli response: {text}"))?;
            if let Some(d) = discovery_from_json(&value) {
                return Ok(d);
            }
            bail!("auth/cli response missing method: {text}");
        }
        if status.as_u16() != 404 {
            bail!("auth discovery failed (HTTP {status}): {}", text.trim());
        }
        // 404 → older dashboard; fall through to legacy probes.
    }

    discover_fallback(client, base).await
}

/// Pre-`/auth/cli` dashboards: device/status + anonymous hosts probe.
async fn discover_fallback(client: &Client, base: &str) -> Result<CliAuthDiscovery> {
    let status_url = format!("{base}/api/v1/auth/device/status");
    if let Ok(resp) = client.get(&status_url).send().await {
        if resp.status().is_success() {
            if let Ok(value) = resp.json::<Value>().await {
                let root = value.get("data").cloned().unwrap_or(value);
                let enabled = root
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if enabled {
                    return Ok(CliAuthDiscovery {
                        method: CliAuthMethod::Device,
                        hint: "Device login enabled (legacy discovery).".into(),
                        device_enabled: true,
                    });
                }
            }
        }
    }

    let hosts_url = format!("{base}/api/v1/hosts");
    let open = match client.get(&hosts_url).send().await {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    };
    if open {
        return Ok(CliAuthDiscovery {
            method: CliAuthMethod::None,
            hint: "Dashboard API appears open (no login needed).".into(),
            device_enabled: false,
        });
    }

    Ok(CliAuthDiscovery {
        method: CliAuthMethod::ApiKey,
        hint: "API key required. Pass --api-key / CHM_API_KEY.".into(),
        device_enabled: false,
    })
}

pub async fn run(client: &Client, cfg: &AppConfig, args: AuthArgs) -> Result<i32> {
    match args.command {
        AuthCommand::Login(login_args) => login(client, cfg, login_args).await,
        AuthCommand::Logout => {
            credentials::clear_token()?;
            credentials::clear_api_key()?;
            success("signed out (cleared stored credentials)");
            Ok(0)
        }
        AuthCommand::Status => {
            let token = credentials::resolve_token(cfg.token.as_deref())?;
            let api_key = credentials::resolve_api_key(cfg.api_key.as_deref())?;
            if cfg.json {
                let v = serde_json::json!({
                    "authenticated": token.is_some() || api_key.is_some(),
                    "has_token": token.is_some(),
                    "has_api_key": api_key.is_some(),
                    "base_url": cfg.base_url,
                });
                crate::output::print_json(&v)?;
            } else if token.is_some() {
                success("signed in (bearer token present)");
            } else if api_key.is_some() {
                success("API key configured (no bearer token)");
            } else {
                println!("not signed in — run `chm auth login`");
            }
            Ok(0)
        }
        AuthCommand::Token => {
            let token = credentials::resolve_token(cfg.token.as_deref())?;
            let Some(token) = token else {
                bail!("no bearer token stored — run `chm auth login` first");
            };
            // stdout only (CI pipes); no success styling.
            println!("{token}");
            Ok(0)
        }
    }
}

async fn login(client: &Client, cfg: &AppConfig, args: AuthLoginArgs) -> Result<i32> {
    let discovery = discover(client, cfg).await?;
    output::info(&format!(
        "auth method: {} — {}",
        discovery.method.as_str(),
        if discovery.hint.is_empty() {
            "ok"
        } else {
            discovery.hint.as_str()
        }
    ));

    match discovery.method {
        CliAuthMethod::None => {
            success("no login needed — dashboard API is open");
            Ok(0)
        }
        CliAuthMethod::Device => device_login(client, cfg).await,
        CliAuthMethod::ApiKey => api_key_login(cfg, args).await,
    }
}

async fn api_key_login(cfg: &AppConfig, args: AuthLoginArgs) -> Result<i32> {
    let key = if let Some(k) = args
        .api_key
        .or(cfg.api_key.clone())
        .filter(|s| !s.trim().is_empty())
    {
        k
    } else {
        eprint!("API key (chm_…): ");
        let _ = io::stderr().flush();
        let mut line = String::new();
        io::stdin()
            .read_line(&mut line)
            .context("failed to read API key from stdin")?;
        let trimmed = line.trim().to_string();
        if trimmed.is_empty() {
            bail!("empty API key — pass --api-key or set CHM_API_KEY");
        }
        trimmed
    };

    if !key.starts_with("chm_") {
        output::warn("key does not start with chm_ — storing anyway");
    }
    credentials::store_api_key(&key)?;
    success("API key stored — use `chm auth status` to verify");
    Ok(0)
}

async fn device_login(client: &Client, cfg: &AppConfig) -> Result<i32> {
    let base = cfg.base_url.trim_end_matches('/');
    let code_url = format!("{base}/api/v1/auth/device/code");

    let resp = client
        .post(&code_url)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "client_id": "chm-cli",
            "scope": "openid profile",
        }))
        .send()
        .await
        .with_context(|| format!("failed to request device code at {code_url}"))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        bail!(
            "device code request failed (HTTP {status}): {}",
            text.trim()
        );
    }

    let value: serde_json::Value = serde_json::from_str(&text)
        .with_context(|| format!("unexpected device-code response: {text}"))?;
    let payload = value.get("data").cloned().unwrap_or(value);
    let device: DeviceCodeResponse = serde_json::from_value(payload)
        .with_context(|| format!("unexpected device-code response: {text}"))?;

    let open_url = device
        .verification_uri_complete
        .clone()
        .unwrap_or_else(|| device.verification_uri.clone());

    println!("To sign in, open:");
    println!("  {open_url}");
    println!();
    println!("And enter code: {}", device.user_code);
    println!();

    if let Err(err) = open::that(&open_url) {
        output::warn(&format!("could not open browser automatically ({err})"));
    } else {
        output::info("opened browser for device authorization");
    }

    let token_url = format!("{base}/api/v1/auth/token");
    let interval = Duration::from_secs(device.interval.max(1));
    let deadline = tokio::time::Instant::now() + Duration::from_secs(device.expires_in.max(30));

    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::with_template("{spinner:.cyan} {msg}")
            .unwrap_or_else(|_| ProgressStyle::default_spinner()),
    );
    pb.set_message("waiting for authorization…");
    pb.enable_steady_tick(Duration::from_millis(120));

    loop {
        if tokio::time::Instant::now() >= deadline {
            pb.finish_and_clear();
            bail!("device authorization timed out — run `chm auth login` again");
        }

        tokio::time::sleep(interval).await;

        let poll = client
            .post(&token_url)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": device.device_code,
                "client_id": "chm-cli",
            }))
            .send()
            .await;

        let Ok(resp) = poll else {
            continue;
        };
        let text = resp.text().await.unwrap_or_default();
        let parsed: TokenResponse = match serde_json::from_str(&text) {
            Ok(p) => p,
            Err(_) => continue,
        };

        if let Some(token) = parsed.access_token {
            if !token.is_empty() {
                pb.finish_and_clear();
                credentials::store_token(&token)?;
                success("signed in — token stored in keyring");
                // Best-effort identity check.
                let me_url = format!("{base}/api/v1/auth/me");
                let token_ref = Some(token.as_str());
                if let Ok(me) = apply_auth(client.get(&me_url), token_ref, None)
                    .send()
                    .await
                {
                    if me.status().is_success() {
                        if let Ok(body) = me.json::<serde_json::Value>().await {
                            if let Some(email) =
                                body.pointer("/principal/email").and_then(|v| v.as_str())
                            {
                                println!("signed in as {email}");
                            }
                        }
                    }
                }
                return Ok(0);
            }
        }

        match parsed.error.as_deref() {
            Some("authorization_pending") | Some("slow_down") => continue,
            Some("expired_token") | Some("access_denied") => {
                pb.finish_and_clear();
                let detail = parsed
                    .error_description
                    .unwrap_or_else(|| parsed.error.unwrap_or_default());
                bail!("authorization failed: {detail}");
            }
            Some(other) => {
                pb.finish_and_clear();
                bail!(
                    "token endpoint error '{other}': {}",
                    parsed.error_description.unwrap_or_default()
                );
            }
            None => continue,
        }
    }
}

/// Re-export discovery for `chm doctor`.
pub async fn discover_for_doctor(client: &Client, cfg: &AppConfig) -> Result<CliAuthDiscovery> {
    discover(client, cfg).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_method_accepts_aliases() {
        assert_eq!(parse_method("none"), Some(CliAuthMethod::None));
        assert_eq!(parse_method("DEVICE"), Some(CliAuthMethod::Device));
        assert_eq!(parse_method("api_key"), Some(CliAuthMethod::ApiKey));
        assert_eq!(parse_method("api-key"), Some(CliAuthMethod::ApiKey));
        assert_eq!(parse_method("apikey"), Some(CliAuthMethod::ApiKey));
        assert_eq!(parse_method("wat"), None);
    }

    #[test]
    fn discovery_from_json_reads_nested_data() {
        let v = json!({
            "data": {
                "method": "device",
                "hint": "Device login enabled.",
                "deviceLogin": { "enabled": true }
            }
        });
        let d = discovery_from_json(&v).expect("parse");
        assert_eq!(d.method, CliAuthMethod::Device);
        assert!(d.device_enabled);
        assert!(d.hint.contains("Device"));
    }

    #[test]
    fn discovery_from_json_flat_payload() {
        let v = json!({
            "method": "api_key",
            "hint": "API key required.",
            "deviceLogin": { "enabled": false }
        });
        let d = discovery_from_json(&v).expect("parse");
        assert_eq!(d.method, CliAuthMethod::ApiKey);
        assert!(!d.device_enabled);
    }

    #[test]
    fn discovery_from_json_none() {
        let v = json!({ "method": "none", "hint": "open" });
        let d = discovery_from_json(&v).expect("parse");
        assert_eq!(d.method, CliAuthMethod::None);
        assert!(!d.device_enabled);
    }
}
