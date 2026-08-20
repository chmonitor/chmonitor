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

/// Full `{ success, data, metadata|meta }` envelope from the dashboard API.
#[derive(Debug, Clone, Deserialize)]
pub struct ApiEnvelope {
    #[serde(default)]
    #[allow(dead_code)]
    pub success: Option<bool>,
    pub data: Value,
    #[serde(default)]
    pub metadata: Option<Value>,
    /// Some older/alternate responses nest metadata under `meta`.
    #[serde(default)]
    pub meta: Option<Value>,
}

impl ApiEnvelope {
    /// Prefer `metadata`, fall back to `meta`.
    pub fn meta_object(&self) -> Option<&Value> {
        self.metadata.as_ref().or(self.meta.as_ref())
    }

    /// SQL / query hint from the response envelope when present.
    pub fn query_hint(&self) -> Option<&str> {
        let meta = self.meta_object()?;
        meta.get("sql")
            .or_else(|| meta.get("query"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
    }
}

pub fn api_error_hint(status: u16) -> &'static str {
    match status {
        401 | 403 => {
            " Check --api-key / CHM_API_KEY, or run `chm auth login` (auto-detects device vs API key)."
        }
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

async fn send_get(
    client: &Client,
    url: &str,
    token: Option<&str>,
    api_key: Option<&str>,
) -> Result<(u16, String)> {
    let req = apply_auth(client.get(url), token, api_key);
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
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    Ok((status, text))
}

fn ensure_success(url: &str, status: u16, text: &str) -> Result<()> {
    if !(200..300).contains(&status) {
        let hint = api_error_hint(status);
        let extra = match truncate_body(text.trim(), 200) {
            None => String::new(),
            Some(body) => format!(" {body}"),
        };
        bail!("chmonitor API returned HTTP {status} for {url}.{hint}{extra}");
    }
    Ok(())
}

pub async fn fetch(
    client: &Client,
    url: String,
    token: Option<&str>,
    api_key: Option<&str>,
) -> Result<Value> {
    let (status, text) = send_get(client, &url, token, api_key).await?;
    ensure_success(&url, status, &text)?;
    let parsed: ApiResponse = serde_json::from_str(&text).with_context(|| {
        format!("chmonitor API at {url} returned a non-JSON body (HTTP {status})")
    })?;
    Ok(parsed.data)
}

/// Fetch the full API envelope (`data` + optional `metadata`/`meta`).
pub async fn fetch_envelope(
    client: &Client,
    url: String,
    token: Option<&str>,
    api_key: Option<&str>,
) -> Result<ApiEnvelope> {
    let (status, text) = send_get(client, &url, token, api_key).await?;
    ensure_success(&url, status, &text)?;
    serde_json::from_str(&text)
        .with_context(|| format!("chmonitor API at {url} returned a non-JSON body (HTTP {status})"))
}

pub async fn fetch_cfg(client: &Client, cfg: &AppConfig, url: String) -> Result<Value> {
    let token = crate::credentials::resolve_token(cfg.token.as_deref())?;
    let api_key = crate::credentials::resolve_api_key(cfg.api_key.as_deref())?;
    fetch(client, url, token.as_deref(), api_key.as_deref()).await
}

pub async fn fetch_envelope_cfg(
    client: &Client,
    cfg: &AppConfig,
    url: String,
) -> Result<ApiEnvelope> {
    let token = crate::credentials::resolve_token(cfg.token.as_deref())?;
    let api_key = crate::credentials::resolve_api_key(cfg.api_key.as_deref())?;
    fetch_envelope(client, url, token.as_deref(), api_key.as_deref()).await
}

fn auth_pair(cfg: &AppConfig) -> Result<(Option<String>, Option<String>)> {
    let token = crate::credentials::resolve_token(cfg.token.as_deref())?;
    let api_key = crate::credentials::resolve_api_key(cfg.api_key.as_deref())?;
    Ok((token, api_key))
}

/// Raw GET (status + body). Caller decides how to treat 4xx/5xx.
pub async fn fetch_status_cfg(
    client: &Client,
    cfg: &AppConfig,
    url: String,
) -> Result<(u16, String)> {
    let (token, api_key) = auth_pair(cfg)?;
    send_get(client, &url, token.as_deref(), api_key.as_deref()).await
}

/// Like [`fetch_cfg`], but HTTP 404 is `Ok(None)` so callers can skip missing charts.
pub async fn fetch_optional_cfg(
    client: &Client,
    cfg: &AppConfig,
    url: String,
) -> Result<Option<Value>> {
    let (status, text) = fetch_status_cfg(client, cfg, url.clone()).await?;
    if status == 404 {
        return Ok(None);
    }
    ensure_success(&url, status, &text)?;
    let parsed: ApiResponse = serde_json::from_str(&text).with_context(|| {
        format!("chmonitor API at {url} returned a non-JSON body (HTTP {status})")
    })?;
    Ok(Some(parsed.data))
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

    #[test]
    fn envelope_prefers_metadata_sql_then_meta_query() {
        let with_meta: ApiEnvelope =
            serde_json::from_str(r#"{"success":true,"data":[],"metadata":{"sql":"SELECT 1"}}"#)
                .unwrap();
        assert_eq!(with_meta.query_hint(), Some("SELECT 1"));

        let with_meta_query: ApiEnvelope =
            serde_json::from_str(r#"{"data":[],"meta":{"query":"SELECT 2"}}"#).unwrap();
        assert_eq!(with_meta_query.query_hint(), Some("SELECT 2"));

        let bare: ApiEnvelope = serde_json::from_str(r#"{"data":[]}"#).unwrap();
        assert!(bare.query_hint().is_none());
    }
}
