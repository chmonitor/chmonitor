//! `chm hosts`

use std::collections::HashMap;

use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::Value;

use crate::{client, config::AppConfig, output};

pub async fn run(client: &Client, cfg: &AppConfig) -> Result<()> {
    let url = format!("{}/api/v1/hosts", cfg.base_url.trim_end_matches('/'));
    let data = client::fetch_cfg(client, cfg, url.clone()).await?;
    if cfg.json {
        output::print_json(&data)?;
        return Ok(());
    }
    let hosts: Vec<HashMap<String, Value>> =
        serde_json::from_value(data).context("hosts payload parse failed")?;
    if hosts.is_empty() {
        eprintln!("no hosts returned from {url}");
    } else {
        output::print_records(&hosts, 100);
    }
    Ok(())
}
