//! HTTP client helpers for the dashboard API.

use anyhow::{bail, Context, Result};
use reqwest::Client;
use serde::Deserialize;
use serde_json::Value;

use crate::config::AppConfig;

#[derive(Debug, Deserialize)]
struct ApiResponse {
    data: Value,
}

pub fn api_error_hint(status: u16) -> &'static str {
    match status {
        401 | 403 => " Check --api-key / CHM_API_KEY or `chm auth login`.",
        404 => " Check the chart/table name and --host-id.",
        _ => "",
    }
}

pub fn truncate_body(s: &str, max_chars: usize) -> Option<String> {
    if s.is_empty() {
        return None;
    }
    let mut iter = s.chars();
    let head: String = iter.by_ref().take(max_chars).collect();
    if iter.next().is_some() {
        Some(format!("{head}…"))
    } else {
        Some(head)
    }
}

/// Attach both Authorization Bearer and x-api-key when present.
pub fn apply_auth(
    mut req: reqwest::RequestBuilder,
    token: Option<&str>,
    api_key: Option<&str>,
) -> reqwest::RequestBuilder {
    if let Some(t) = token {
        if !t.is_empty() {
            req = req.header("Authorization", format!("Bearer {t}"));
        }
    }
    if let Some(k) = api_key {
        if !k.is_empty() {
            req = req.header("x-api-key", k);
        }
    }
    req
}

pub async fn fetch(
    client: &Client,
    url: String,
    token: Option<&str>,
    api_key: Option<&str>,
) -> Result<Value> {
    let req = apply_auth(client.get(&url), token, api_key);
    let resp = match req.send().await {
        Ok(resp) => resp,
        Err(err) => {
            bail!(
                "failed to reach chmonitor API at {url}: {err}\n\
                 Is the dashboard reachable? Set --base-url / CHM_BASE_URL \
                 (default {}).",
                crate::config::DEFAULT_BASE_URL
            );
        }
    };
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let hint = api_error_hint(status.as_u16());
        let extra = match truncate_body(text.trim(), 200) {
            None => String::new(),
            Some(body) => format!(" {body}"),
        };
        bail!("chmonitor API returned HTTP {status} for {url}.{hint}{extra}");
    }
    let parsed: ApiResponse = serde_json::from_str(&text).with_context(|| {
        format!("chmonitor API at {url} returned a non-JSON body (HTTP {status})")
    })?;
    Ok(parsed.data)
}

pub async fn fetch_cfg(client: &Client, cfg: &AppConfig, url: String) -> Result<Value> {
    let token = crate::credentials::resolve_token(cfg.token.as_deref())?;
    let api_key = crate::credentials::resolve_api_key(cfg.api_key.as_deref())?;
    fetch(client, url, token.as_deref(), api_key.as_deref()).await
}

pub fn rows_from_chart_data(data: Value) -> Result<Vec<Value>> {
    match data {
        Value::Array(rows) => Ok(rows),
        Value::Object(mut queries) => {
            if let Some(Value::Array(rows)) = queries.remove("main") {
                return Ok(rows);
            }

            let rows = queries
                .into_values()
                .filter_map(|value| match value {
                    Value::Array(rows) => Some(rows),
                    _ => None,
                })
                .flatten()
                .collect();
            Ok(rows)
        }
        other => bail!("chart payload data must be an array or object, got {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_error_hint_covers_auth_and_missing() {
        assert!(api_error_hint(401).contains("CHM_API_KEY"));
        assert!(api_error_hint(403).contains("CHM_API_KEY"));
        assert!(api_error_hint(404).contains("host-id"));
        assert_eq!(api_error_hint(500), "");
    }

    #[test]
    fn truncate_body_is_char_safe() {
        assert_eq!(truncate_body("", 8), None);
        assert_eq!(truncate_body("hello", 8).as_deref(), Some("hello"));
        assert_eq!(truncate_body("éééé", 2).as_deref(), Some("éé…"));
    }
}
