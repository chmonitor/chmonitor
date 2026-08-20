//! `chm audit`

use anyhow::{bail, Context, Result};
use reqwest::Client;

use crate::{
    cli::{AuditArgs, AuditCommand},
    client,
    config::AppConfig,
    output,
};

pub async fn run(client: &Client, cfg: &AppConfig, args: AuditArgs) -> Result<()> {
    match args.command {
        AuditCommand::Export { limit } => {
            let url = format!(
                "{}/api/v1/audit/export?limit={}",
                cfg.base_url.trim_end_matches('/'),
                limit
            );
            let data = match client::fetch_cfg(client, cfg, url.clone()).await {
                Ok(d) => d,
                Err(err) => {
                    // Some deployments wrap differently; try raw GET body.
                    let token = crate::credentials::resolve_token(cfg.token.as_deref())?;
                    let api_key = crate::credentials::resolve_api_key(cfg.api_key.as_deref())?;
                    let resp = crate::client::apply_auth(
                        client.get(&url),
                        token.as_deref(),
                        api_key.as_deref(),
                    )
                    .send()
                    .await
                    .with_context(|| format!("audit export failed: {err}"))?;
                    let status = resp.status();
                    let text = resp.text().await.unwrap_or_default();
                    if !status.is_success() {
                        bail!("audit export HTTP {status}: {text}");
                    }
                    serde_json::from_str(&text).unwrap_or(serde_json::json!({ "raw": text }))
                }
            };
            output::print_json(&data)?;
            Ok(())
        }
    }
}
