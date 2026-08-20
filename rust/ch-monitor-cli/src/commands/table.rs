//! `chm table`

use std::collections::HashMap;

use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::{json, Value};

use crate::{client, config::AppConfig, output};

pub async fn run(
    client: &Client,
    cfg: &AppConfig,
    name: &str,
    limit: usize,
    explain: bool,
) -> Result<()> {
    let page_size = if explain { limit.max(1) } else { limit };
    let url = format!(
        "{}/api/v1/tables/{}?hostId={}&pageSize={}",
        cfg.base_url.trim_end_matches('/'),
        name,
        cfg.host_id,
        page_size
    );

    if explain {
        return run_explain(client, cfg, name, &url, limit).await;
    }

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

async fn run_explain(
    client: &Client,
    cfg: &AppConfig,
    name: &str,
    url: &str,
    limit: usize,
) -> Result<()> {
    let envelope = client::fetch_envelope_cfg(client, cfg, url.to_string()).await?;
    let columns = column_names_from_data(&envelope.data);
    let sql_hint = envelope.query_hint().map(str::to_string);
    let openapi_note = if sql_hint.is_none() {
        try_openapi_table_hint(client, cfg, name).await
    } else {
        None
    };

    if cfg.json {
        let mut out = json!({
            "name": name,
            "hostId": cfg.host_id,
            "columns": columns,
            "data": envelope.data,
        });
        if let Some(sql) = &sql_hint {
            out["sql"] = json!(sql);
        }
        if let Some(meta) = envelope.meta_object() {
            out["metadata"] = meta.clone();
        }
        if let Some(note) = &openapi_note {
            out["openapi"] = json!(note);
        }
        if sql_hint.is_none() {
            out["note"] = json!(
                "No per-column docs from the API. Columns inferred from the first data row; \
                 SQL is in metadata.sql when the dashboard exposes it."
            );
        }
        output::print_json(&out)?;
        return Ok(());
    }

    println!("table: {name}");
    println!("hostId: {}", cfg.host_id);
    if columns.is_empty() {
        println!("columns: (none — empty result; try without --explain or raise --limit)");
    } else {
        println!("columns:");
        for col in &columns {
            println!("  - {col}");
        }
    }
    match &sql_hint {
        Some(sql) => {
            println!("sql:");
            println!("{sql}");
        }
        None => {
            println!(
                "note: no query-config column docs endpoint; columns inferred from data. \
                 SQL appears in the response envelope as metadata.sql when available."
            );
            if let Some(note) = &openapi_note {
                println!("openapi: {note}");
            }
        }
    }
    if let Some(meta) = envelope.meta_object() {
        if let Some(duration) = meta.get("duration") {
            println!("duration: {duration}");
        }
        if let Some(rows) = meta.get("rows") {
            println!("rows: {rows}");
        }
        if meta.get("unavailable").and_then(|v| v.as_bool()) == Some(true) {
            if let Some(reason) = meta.get("unavailableReason").and_then(|v| v.as_str()) {
                println!("unavailable: {reason}");
            }
        }
    }

    if let Ok(rows) = serde_json::from_value::<Vec<HashMap<String, Value>>>(envelope.data.clone()) {
        if !rows.is_empty() {
            println!();
            output::print_records(&rows, limit);
        }
    }
    Ok(())
}

fn column_names_from_data(data: &Value) -> Vec<String> {
    match data {
        Value::Array(rows) => rows
            .first()
            .and_then(|r| r.as_object())
            .map(|o| o.keys().cloned().collect())
            .unwrap_or_default(),
        Value::Object(map) => map.keys().cloned().collect(),
        _ => Vec::new(),
    }
}

/// Best-effort: pull the OpenAPI description for `/api/v1/tables/{name}`.
/// OpenAPI is a raw document (not `{data:…}`), so we GET it directly.
async fn try_openapi_table_hint(client: &Client, cfg: &AppConfig, name: &str) -> Option<String> {
    let url = format!("{}/api/v1/openapi.json", cfg.base_url.trim_end_matches('/'));
    let token = crate::credentials::resolve_token(cfg.token.as_deref()).ok()?;
    let api_key = crate::credentials::resolve_api_key(cfg.api_key.as_deref()).ok()?;
    let req = client::apply_auth(client.get(&url), token.as_deref(), api_key.as_deref());
    let resp = req.send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let doc: Value = resp.json().await.ok()?;
    extract_openapi_table_description(&doc, name)
}

fn extract_openapi_table_description(doc: &Value, _name: &str) -> Option<String> {
    let path = doc.get("paths")?.get("/api/v1/tables/{name}")?;
    let get = path.get("get").unwrap_or(path);
    let desc = get
        .get("description")
        .or_else(|| get.get("summary"))
        .and_then(|v| v.as_str())?;
    let trimmed = desc.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn column_names_from_first_row() {
        let data = json!([{"query_id": "1", "user": "default"}, {"query_id": "2"}]);
        let cols = column_names_from_data(&data);
        assert!(cols.contains(&"query_id".into()));
        assert!(cols.contains(&"user".into()));
    }

    #[test]
    fn column_names_empty_array() {
        assert!(column_names_from_data(&json!([])).is_empty());
    }

    #[test]
    fn openapi_extracts_tables_path_description() {
        let doc = json!({
            "paths": {
                "/api/v1/tables/{name}": {
                    "get": {
                        "summary": "Named table page",
                        "description": "Runs a registered QueryConfig."
                    }
                }
            }
        });
        let hint = extract_openapi_table_description(&doc, "running-queries");
        assert_eq!(hint.as_deref(), Some("Runs a registered QueryConfig."));
    }
}
