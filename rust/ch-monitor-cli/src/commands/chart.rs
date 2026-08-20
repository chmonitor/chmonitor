//! `chm chart`

use std::collections::HashMap;

use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::Value;

use crate::{client, config::AppConfig, metrics, output};

pub async fn run(client: &Client, cfg: &AppConfig, name: &str, limit: usize) -> Result<()> {
    let url = format!(
        "{}/api/v1/charts/{}?hostId={}",
        cfg.base_url.trim_end_matches('/'),
        name,
        cfg.host_id
    );
    let data = client::fetch_cfg(client, cfg, url.clone()).await?;
    let rows_raw = client::rows_from_chart_data(data)?;
    if cfg.json {
        output::print_json(&Value::Array(rows_raw))?;
        return Ok(());
    }
    let data = Value::Array(rows_raw.clone());
    let rows: Vec<HashMap<String, Value>> =
        serde_json::from_value(data).context("chart payload parse failed")?;
    if rows.is_empty() {
        eprintln!("no rows returned from {url}");
    } else {
        let points: Vec<u64> = rows_raw.iter().map(metrics::row_metric).collect();
        if !cfg.quiet && !points.is_empty() {
            println!("{}", output::braille_sparkline(&points, 40));
        }
        output::print_records(&rows, limit);
    }
    Ok(())
}
