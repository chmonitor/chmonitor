//! `chm auth` — device-code login against the dashboard.

use std::time::Duration;

use anyhow::{bail, Context, Result};
use indicatif::{ProgressBar, ProgressStyle};
use reqwest::Client;
use serde::Deserialize;

use crate::{
    cli::{AuthArgs, AuthCommand},
    client::apply_auth,
    config::AppConfig,
    credentials,
    output::{self, success},
};

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

pub async fn run(client: &Client, cfg: &AppConfig, args: AuthArgs) -> Result<i32> {
    match args.command {
        AuthCommand::Login => login(client, cfg).await,
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
    }
}

async fn login(client: &Client, cfg: &AppConfig) -> Result<i32> {
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
