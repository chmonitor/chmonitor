//! `chm doctor` — local + API connectivity checks.

use anyhow::Result;
use reqwest::Client;

use crate::{
    client,
    commands::auth::{self, CliAuthMethod},
    config::AppConfig,
    credentials, output,
};

pub async fn run(client: &Client, cfg: &AppConfig) -> Result<()> {
    let mut checks: Vec<(String, bool, String)> = Vec::new();

    checks.push((
        "cli_version".into(),
        true,
        format!("{} ({})", env!("CARGO_PKG_VERSION"), env!("CHM_TARGET")),
    ));

    checks.push((
        "base_url".into(),
        !cfg.base_url.is_empty(),
        cfg.base_url.clone(),
    ));

    let discovery = auth::discover_for_doctor(client, cfg).await.ok();
    let auth_method = discovery
        .as_ref()
        .map(|d| d.method)
        .unwrap_or(CliAuthMethod::ApiKey);
    checks.push((
        "auth_method".into(),
        discovery.is_some(),
        match &discovery {
            Some(d) => {
                let mut detail = d.method.as_str().to_string();
                if d.device_enabled {
                    detail.push_str(", device_enabled");
                }
                if !d.hint.is_empty() {
                    detail.push_str(&format!(" ({})", d.hint));
                }
                detail
            }
            None => "unreachable".into(),
        },
    ));

    let token = credentials::resolve_token(cfg.token.as_deref())?;
    let api_key = credentials::resolve_api_key(cfg.api_key.as_deref())?;
    let creds_ok = match auth_method {
        CliAuthMethod::None => true,
        CliAuthMethod::Device | CliAuthMethod::ApiKey => token.is_some() || api_key.is_some(),
    };
    checks.push((
        "credentials".into(),
        creds_ok,
        if token.is_some() {
            "bearer token".into()
        } else if api_key.is_some() {
            "api key".into()
        } else if auth_method == CliAuthMethod::None {
            "none (open API)".into()
        } else {
            "none — run `chm auth login`".into()
        },
    ));

    let health_url = format!("{}/api/healthz", cfg.base_url.trim_end_matches('/'));
    let health_ok = match client.get(&health_url).send().await {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    };
    checks.push((
        "dashboard_health".into(),
        health_ok,
        if health_ok {
            "ok".into()
        } else {
            format!("unreachable ({health_url})")
        },
    ));

    let hosts_url = format!("{}/api/v1/hosts", cfg.base_url.trim_end_matches('/'));
    let hosts_ok = client::fetch_cfg(client, cfg, hosts_url).await.is_ok();
    checks.push((
        "hosts_api".into(),
        hosts_ok,
        if hosts_ok {
            "ok".into()
        } else {
            "failed".into()
        },
    ));

    if cfg.json {
        let arr: Vec<_> = checks
            .iter()
            .map(|(name, ok, detail)| {
                serde_json::json!({ "check": name, "ok": ok, "detail": detail })
            })
            .collect();
        output::print_json(&serde_json::Value::Array(arr))?;
    } else {
        for (name, ok, detail) in &checks {
            let mark = if *ok { "ok" } else { "FAIL" };
            println!("{mark:>4}  {name:<20} {detail}");
        }
    }

    if !cfg.quiet {
        output::info(
            "pass --ch-host or set CLICKHOUSE_HOST to run a cluster health scan", // pragma: allowlist secret
        );
    }

    if checks.iter().any(|(_, ok, _)| !*ok) {
        anyhow::bail!("doctor found failing checks");
    }
    Ok(())
}
