//! `chm agent` — one-shot AI agent request.

use std::io::{self, Read};

use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::Value;

use crate::{client::apply_auth, config::AppConfig, credentials, output};

pub async fn run(
    client: &Client,
    cfg: &AppConfig,
    prompt: Option<String>,
    model: Option<String>,
) -> Result<()> {
    let text = match prompt {
        Some(p) if !p.trim().is_empty() => p,
        _ => {
            let mut buf = String::new();
            io::stdin()
                .read_to_string(&mut buf)
                .context("failed to read prompt from stdin")?;
            if buf.trim().is_empty() {
                bail!("no prompt given — pass an argument or pipe text on stdin");
            }
            buf
        }
    };

    let url = format!("{}/api/v1/agent", cfg.base_url.trim_end_matches('/'));
    let mut body = serde_json::json!({
        "message": text.trim(),
        "hostId": cfg.host_id,
    });
    if let Some(m) = model {
        body["model"] = Value::String(m);
    }

    let token = credentials::resolve_token(cfg.token.as_deref())?;
    let api_key = credentials::resolve_api_key(cfg.api_key.as_deref())?;

    let resp = apply_auth(client.post(&url), token.as_deref(), api_key.as_deref())
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .with_context(|| format!("failed to reach agent at {url}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        bail!(
            "agent returned HTTP {status}: {}",
            crate::client::truncate_body(text.trim(), 300).unwrap_or_default()
        );
    }

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if content_type.contains("text/event-stream") || content_type.contains("text/plain") {
        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("error reading agent stream")?;
            let text = String::from_utf8_lossy(&chunk);
            for line in text.split('\n') {
                let line = line.trim_end_matches('\r');
                if let Some(data) = line.strip_prefix("data:") {
                    let data = data.trim();
                    if data.is_empty() || data == "[DONE]" {
                        continue;
                    }
                    if let Ok(v) = serde_json::from_str::<Value>(data) {
                        if let Some(delta) = extract_text_delta(&v) {
                            print!("{delta}");
                            let _ = io::Write::flush(&mut io::stdout());
                            buffer.push_str(&delta);
                        }
                    } else {
                        print!("{data}");
                        let _ = io::Write::flush(&mut io::stdout());
                        buffer.push_str(data);
                    }
                }
            }
        }
        if !buffer.ends_with('\n') {
            println!();
        }
        if cfg.json {
            output::print_json(&serde_json::json!({ "text": buffer }))?;
        }
    } else {
        let text = resp.text().await.unwrap_or_default();
        if cfg.json {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                output::print_json(&v)?;
            } else {
                output::print_json(&serde_json::json!({ "text": text }))?;
            }
        } else {
            println!("{text}");
        }
    }
    Ok(())
}

fn extract_text_delta(v: &Value) -> Option<String> {
    if let Some(s) = v.get("delta").and_then(|d| d.as_str()) {
        return Some(s.to_string());
    }
    if let Some(s) = v
        .pointer("/choices/0/delta/content")
        .and_then(|d| d.as_str())
    {
        return Some(s.to_string());
    }
    if let Some(s) = v.get("text").and_then(|d| d.as_str()) {
        return Some(s.to_string());
    }
    if let Some(s) = v.pointer("/0/text").and_then(|d| d.as_str()) {
        return Some(s.to_string());
    }
    // AI SDK UI message stream: type=text-delta
    if v.get("type").and_then(|t| t.as_str()) == Some("text-delta") {
        if let Some(s) = v.get("delta").and_then(|d| d.as_str()) {
            return Some(s.to_string());
        }
        if let Some(s) = v.get("textDelta").and_then(|d| d.as_str()) {
            return Some(s.to_string());
        }
    }
    None
}
