//! Terminal UI: chart overview + streaming chat.

pub mod chat;

use std::{
    io,
    time::{Duration, Instant},
};

use anyhow::Result;
use crossterm::{
    event, execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    layout::{Constraint, Direction, Layout},
    widgets::{Block, Borders, Paragraph, Row, Sparkline, Table as TuiTable},
    Terminal,
};
use reqwest::Client;

use crate::{client, config::AppConfig, metrics};

const TUI_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
const TUI_EVENT_POLL_INTERVAL: Duration = Duration::from_millis(250);

struct TuiGuard;

impl Drop for TuiGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
    }
}

pub async fn run(client: &Client, cfg: &AppConfig, chart: &str, overview: bool) -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let _guard = TuiGuard;

    let backend = ratatui::backend::CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let mut rows = Vec::new();
    let mut points = Vec::new();
    let mut error_message = None;
    let mut next_refresh_at = Instant::now();
    let mut hosts_summary = String::new();

    loop {
        let now = Instant::now();
        if now >= next_refresh_at {
            if overview {
                let hosts_url =
                    format!("{}/api/v1/hosts", cfg.base_url.trim_end_matches('/'));
                match client::fetch_cfg(client, cfg, hosts_url).await {
                    Ok(data) => {
                        error_message = None;
                        if let Some(arr) = data.as_array() {
                            hosts_summary = format!("{} host(s)", arr.len());
                        } else {
                            hosts_summary = "hosts ok".into();
                        }
                    }
                    Err(err) => {
                        error_message = Some(err.to_string());
                        hosts_summary.clear();
                    }
                }
            }

            let url = format!(
                "{}/api/v1/charts/{}?hostId={}",
                cfg.base_url.trim_end_matches('/'),
                chart,
                cfg.host_id
            );
            let rows_result = client::fetch_cfg(client, cfg, url)
                .await
                .and_then(client::rows_from_chart_data);
            if rows_result.is_err() && error_message.is_none() {
                error_message = rows_result.as_ref().err().map(ToString::to_string);
            } else if rows_result.is_ok() && !overview {
                error_message = None;
            }
            rows = rows_result.unwrap_or_default();
            points = rows.iter().take(80).map(metrics::row_metric).collect();
            next_refresh_at = Instant::now() + TUI_REFRESH_INTERVAL;
        }

        terminal.draw(|f| {
            let chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Length(3), Constraint::Min(5)].as_ref())
                .split(f.area());
            let mode = if overview { "overview" } else { "chart" };
            f.render_widget(
                Paragraph::new(format!(
                    "chm tui ({mode}) | chart={chart} | q=quit | r=refresh | host={}{}{}",
                    cfg.host_id,
                    if hosts_summary.is_empty() {
                        String::new()
                    } else {
                        format!(" | {hosts_summary}")
                    },
                    error_message
                        .as_ref()
                        .map(|message| format!(" | error={message}"))
                        .unwrap_or_default()
                )),
                chunks[0],
            );
            let rows_widget: Vec<Row> = rows
                .iter()
                .take(10)
                .filter_map(|r| r.as_object())
                .map(|o| {
                    let kv = o
                        .iter()
                        .map(|(k, v)| format!("{k}:{v}"))
                        .collect::<Vec<_>>()
                        .join(" | ");
                    Row::new(vec![kv])
                })
                .collect();
            let inner = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Length(5), Constraint::Min(5)])
                .split(chunks[1]);
            let spark = Sparkline::default()
                .block(Block::default().title("Trend").borders(Borders::ALL))
                .data(&points);
            f.render_widget(spark, inner[0]);
            let table = TuiTable::new(rows_widget, [Constraint::Percentage(100)])
                .block(Block::default().title("Recent rows").borders(Borders::ALL));
            f.render_widget(table, inner[1]);
        })?;

        let poll_timeout = next_refresh_at
            .saturating_duration_since(Instant::now())
            .min(TUI_EVENT_POLL_INTERVAL);
        if event::poll(poll_timeout)? {
            match event::read()? {
                event::Event::Key(k) if matches!(k.code, event::KeyCode::Char('q')) => break,
                event::Event::Key(k) if matches!(k.code, event::KeyCode::Char('r')) => {
                    next_refresh_at = Instant::now()
                }
                event::Event::Resize(_, _) => continue,
                _ => {}
            }
        }
    }

    Ok(())
}
