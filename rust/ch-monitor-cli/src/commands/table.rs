//! `chm table`

use std::collections::HashMap;

use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::Value;

use crate::{client, config::AppConfig, output};

pub async fn run(client: &Client, cfg: &AppConfig, name: &str, limit: usize) -> Result<()> {
    let url = format!(
        "{}/api/v1/tables/{}?hostId={}&pageSize={}",
        cfg.base_url.trim_end_matches('/'),
        name,
        cfg.host_id,
        limit
    );
    let data = client::fetch_cfg(client, cfg, url.clone()).await?;
    if cfg.json {
        output::print_json(&data)?;
        return Ok(());
    }
    let rows: Vec<HashMap<String, Value>> =
        serde_json::from_value(data).context("table payload parse failed")?;
    if rows.is_empty() {
        eprintln!("no rows returned from {url}");
    } else {
        output::print_records(&rows, limit);
    }
    Ok(())
}
