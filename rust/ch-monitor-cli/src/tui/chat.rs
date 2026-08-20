//! Streaming chat TUI / non-interactive chat against `/api/v1/agent`.

use std::io::{self, IsTerminal, Read, Write};

use anyhow::{bail, Context, Result};
use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use futures_util::StreamExt;
use ratatui::{
    layout::{Constraint, Direction, Layout},
    widgets::{Block, Borders, Paragraph, Wrap},
    Terminal,
};
use reqwest::Client;
use serde_json::Value;

use crate::{client::apply_auth, config::AppConfig, credentials};

struct ChatGuard;

impl Drop for ChatGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
    }
}

pub async fn run(client: &Client, cfg: &AppConfig, message: Option<String>) -> Result<()> {
    let initial = match message {
        Some(m) if !m.trim().is_empty() => Some(m),
        None if !io::stdin().is_terminal() => {
            let mut buf = String::new();
            io::stdin().read_to_string(&mut buf)?;
            let t = buf.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        }
        _ => None,
    };

    // Non-interactive one-shot when a message is provided and stdout isn't a TTY chat.
    if let Some(msg) = initial {
        if !io::stdout().is_terminal() || cfg.json {
            return stream_once(client, cfg, &msg).await;
        }
        return run_tui(client, cfg, Some(msg)).await;
    }

    if !io::stdin().is_terminal() {
        bail!("no chat message given — pass an argument or run in a terminal");
    }
    run_tui(client, cfg, None).await
}

async fn stream_once(client: &Client, cfg: &AppConfig, message: &str) -> Result<()> {
    let text = stream_agent(client, cfg, message).await?;
    if cfg.json {
        crate::output::print_json(&serde_json::json!({ "text": text }))?;
    } else {
        print!("{text}");
        if !text.ends_with('\n') {
            println!();
        }
    }
    Ok(())
}

async fn stream_agent(client: &Client, cfg: &AppConfig, message: &str) -> Result<String> {
    let url = format!("{}/api/v1/agent", cfg.base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "message": message,
        "hostId": cfg.host_id,
    });
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

    let mut out = String::new();
    let mut stream = resp.bytes_stream();
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
                        out.push_str(&delta);
                    }
                } else {
                    out.push_str(data);
                }
            }
        }
    }
    Ok(out)
}

fn extract_text_delta(v: &Value) -> Option<String> {
    if let Some(s) = v.get("delta").and_then(|d| d.as_str()) {
        return Some(s.to_string());
    }
    if v.get("type").and_then(|t| t.as_str()) == Some("text-delta") {
        if let Some(s) = v.get("delta").and_then(|d| d.as_str()) {
            return Some(s.to_string());
        }
        if let Some(s) = v.get("textDelta").and_then(|d| d.as_str()) {
            return Some(s.to_string());
        }
    }
    if let Some(s) = v.get("text").and_then(|d| d.as_str()) {
        return Some(s.to_string());
    }
    None
}

async fn run_tui(client: &Client, cfg: &AppConfig, seed: Option<String>) -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let _guard = ChatGuard;

    let backend = ratatui::backend::CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut input = String::new();
    let mut log: Vec<String> = Vec::new();
    let mut busy = false;
    let mut pending: Option<String> = seed;

    loop {
        if let Some(msg) = pending.take() {
            busy = true;
            log.push(format!("you> {msg}"));
            terminal.draw(|f| draw_chat(f, &log, &input, busy))?;
            match stream_agent(client, cfg, &msg).await {
                Ok(reply) => log.push(format!("agent> {reply}")),
                Err(err) => log.push(format!("error> {err}")),
            }
            busy = false;
        }

        terminal.draw(|f| draw_chat(f, &log, &input, busy))?;

        if event::poll(std::time::Duration::from_millis(100))? {
            match event::read()? {
                Event::Key(k) if k.code == KeyCode::Esc => break,
                Event::Key(k)
                    if k.code == KeyCode::Char('c')
                        && k.modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    break
                }
                Event::Key(k) if k.code == KeyCode::Enter && !busy => {
                    let msg = input.trim().to_string();
                    input.clear();
                    if msg.eq_ignore_ascii_case("/quit") || msg.eq_ignore_ascii_case("/exit") {
                        break;
                    }
                    if !msg.is_empty() {
                        pending = Some(msg);
                    }
                }
                Event::Key(k) if k.code == KeyCode::Backspace && !busy => {
                    input.pop();
                }
                Event::Key(k) if matches!(k.code, KeyCode::Char(_)) && !busy => {
                    if let KeyCode::Char(c) = k.code {
                        input.push(c);
                    }
                }
                _ => {}
            }
        }
    }
    Ok(())
}

fn draw_chat(f: &mut ratatui::Frame<'_>, log: &[String], input: &str, busy: bool) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(3), Constraint::Length(3)])
        .split(f.area());
    let body = log.join("\n\n");
    f.render_widget(
        Paragraph::new(body).wrap(Wrap { trim: false }).block(
            Block::default()
                .title("chm chat (Esc quit)")
                .borders(Borders::ALL),
        ),
        chunks[0],
    );
    let prompt = if busy {
        "… thinking".to_string()
    } else {
        format!("> {input}")
    };
    f.render_widget(
        Paragraph::new(prompt).block(Block::default().title("input").borders(Borders::ALL)),
        chunks[1],
    );
    let _ = io::stdout().flush();
}
