//! Terminal UI: multi-pane overview / chart / table.
//!
//! Alt-screen is entered only by `chm tui` (this module) and `chm chat`
//! (`tui/chat.rs`). Other commands must never call EnterAlternateScreen.

pub mod chat;

use std::{
    io,
    time::{Duration, Instant},
};

use anyhow::Result;
use crossterm::{
    event::{self, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    layout::{Constraint, Direction, Layout},
    widgets::{Block, Borders, Paragraph, Row, Sparkline, Table as TuiTable},
    Terminal,
};
use reqwest::Client;
use serde_json::Value;

use crate::{client, config::AppConfig, metrics};

const TUI_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
const TUI_EVENT_POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TuiMode {
    Overview,
    Chart,
    Table,
}

impl TuiMode {
    fn label(self) -> &'static str {
        match self {
            TuiMode::Overview => "overview",
            TuiMode::Chart => "chart",
            TuiMode::Table => "table",
        }
    }
}

struct TuiGuard;

impl Drop for TuiGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
    }
}

pub struct TuiOptions<'a> {
    pub chart: &'a str,
    pub table: &'a str,
    pub page_size: usize,
    pub start_overview: bool,
}

pub async fn run(client: &Client, cfg: &AppConfig, opts: TuiOptions<'_>) -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let _guard = TuiGuard;

    let backend = ratatui::backend::CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut mode = if opts.start_overview {
        TuiMode::Overview
    } else {
        TuiMode::Chart
    };
    let mut host_id = cfg.host_id;
    let mut chart_rows: Vec<Value> = Vec::new();
    let mut points: Vec<u64> = Vec::new();
    let mut table_rows: Vec<Value> = Vec::new();
    let mut table_scroll: usize = 0;
    let mut error_message: Option<String> = None;
    let mut hosts_summary = String::new();
    let mut next_refresh_at = Instant::now();

    loop {
        let now = Instant::now();
        if now >= next_refresh_at {
            error_message = None;
            match refresh(
                client,
                cfg,
                mode,
                host_id,
                opts.chart,
                opts.table,
                opts.page_size,
                &mut hosts_summary,
                &mut chart_rows,
                &mut points,
                &mut table_rows,
            )
            .await
            {
                Ok(()) => {}
                Err(err) => error_message = Some(err.to_string()),
            }
            next_refresh_at = Instant::now() + TUI_REFRESH_INTERVAL;
        }

        terminal.draw(|f| {
            let chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Length(3), Constraint::Min(5)].as_ref())
                .split(f.area());

            let header = format!(
                "chm tui | mode={} | host={} | channel={} | chart={} | table={} | \
                 1/2/3 panes  h/l or [/] host  r refresh  q quit{}{}",
                mode.label(),
                host_id,
                cfg.channel,
                opts.chart,
                opts.table,
                if hosts_summary.is_empty() {
                    String::new()
                } else {
                    format!(" | {hosts_summary}")
                },
                error_message
                    .as_ref()
                    .map(|message| format!(" | error={message}"))
                    .unwrap_or_default()
            );
            f.render_widget(Paragraph::new(header), chunks[0]);

            match mode {
                TuiMode::Overview => {
                    draw_overview(f, chunks[1], &hosts_summary, &points, &chart_rows)
                }
                TuiMode::Chart => draw_chart(f, chunks[1], &points, &chart_rows),
                TuiMode::Table => draw_table(f, chunks[1], &table_rows, table_scroll),
            }
        })?;

        let poll_timeout = next_refresh_at
            .saturating_duration_since(Instant::now())
            .min(TUI_EVENT_POLL_INTERVAL);
        if event::poll(poll_timeout)? {
            match event::read()? {
                event::Event::Key(k) => match k.code {
                    KeyCode::Char('q') => break,
                    KeyCode::Char('r') => next_refresh_at = Instant::now(),
                    KeyCode::Char('1') => {
                        mode = TuiMode::Overview;
                        next_refresh_at = Instant::now();
                    }
                    KeyCode::Char('2') => {
                        mode = TuiMode::Chart;
                        next_refresh_at = Instant::now();
                    }
                    KeyCode::Char('3') => {
                        mode = TuiMode::Table;
                        table_scroll = 0;
                        next_refresh_at = Instant::now();
                    }
                    KeyCode::Char('h') | KeyCode::Char('[') => {
                        host_id = host_id.saturating_sub(1);
                        next_refresh_at = Instant::now();
                    }
                    KeyCode::Char('l') | KeyCode::Char(']') => {
                        host_id = host_id.saturating_add(1);
                        next_refresh_at = Instant::now();
                    }
                    KeyCode::Down | KeyCode::Char('j') => {
                        if mode == TuiMode::Table {
                            let max_scroll = table_rows.len().saturating_sub(1);
                            table_scroll = (table_scroll + 1).min(max_scroll);
                        }
                    }
                    KeyCode::Up | KeyCode::Char('k') => {
                        if mode == TuiMode::Table {
                            table_scroll = table_scroll.saturating_sub(1);
                        }
                    }
                    _ => {}
                },
                event::Event::Resize(_, _) => continue,
                _ => {}
            }
        }
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn refresh(
    client: &Client,
    cfg: &AppConfig,
    mode: TuiMode,
    host_id: u32,
    chart: &str,
    table: &str,
    page_size: usize,
    hosts_summary: &mut String,
    chart_rows: &mut Vec<Value>,
    points: &mut Vec<u64>,
    table_rows: &mut Vec<Value>,
) -> Result<()> {
    match mode {
        TuiMode::Overview => {
            let hosts_url = format!("{}/api/v1/hosts", cfg.base_url.trim_end_matches('/'));
            match client::fetch_cfg(client, cfg, hosts_url).await {
                Ok(data) => {
                    if let Some(arr) = data.as_array() {
                        *hosts_summary = format!("{} host(s)", arr.len());
                    } else {
                        *hosts_summary = "hosts ok".into();
                    }
                }
                Err(err) => {
                    hosts_summary.clear();
                    return Err(err);
                }
            }
            fetch_chart(client, cfg, chart, host_id, chart_rows, points).await?;
        }
        TuiMode::Chart => {
            hosts_summary.clear();
            fetch_chart(client, cfg, chart, host_id, chart_rows, points).await?;
        }
        TuiMode::Table => {
            hosts_summary.clear();
            let url = format!(
                "{}/api/v1/tables/{}?hostId={}&pageSize={}",
                cfg.base_url.trim_end_matches('/'),
                table,
                host_id,
                page_size
            );
            let data = client::fetch_cfg(client, cfg, url).await?;
            *table_rows = match data {
                Value::Array(rows) => rows,
                other => vec![other],
            };
        }
    }
    Ok(())
}

async fn fetch_chart(
    client: &Client,
    cfg: &AppConfig,
    chart: &str,
    host_id: u32,
    chart_rows: &mut Vec<Value>,
    points: &mut Vec<u64>,
) -> Result<()> {
    let url = format!(
        "{}/api/v1/charts/{}?hostId={}",
        cfg.base_url.trim_end_matches('/'),
        chart,
        host_id
    );
    let rows = client::fetch_cfg(client, cfg, url)
        .await
        .and_then(client::rows_from_chart_data)?;
    *points = rows.iter().take(80).map(metrics::row_metric).collect();
    *chart_rows = rows;
    Ok(())
}

fn draw_overview(
    f: &mut ratatui::Frame<'_>,
    area: ratatui::layout::Rect,
    hosts_summary: &str,
    points: &[u64],
    chart_rows: &[Value],
) {
    let inner = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(5),
            Constraint::Min(5),
        ])
        .split(area);
    f.render_widget(
        Paragraph::new(if hosts_summary.is_empty() {
            "hosts: (loading…)".into()
        } else {
            format!("Hosts summary: {hosts_summary}")
        })
        .block(Block::default().title("Overview").borders(Borders::ALL)),
        inner[0],
    );
    let spark = Sparkline::default()
        .block(
            Block::default()
                .title("Default chart sparkline")
                .borders(Borders::ALL),
        )
        .data(points);
    f.render_widget(spark, inner[1]);
    render_row_list(f, inner[2], "Recent chart rows", chart_rows, 0);
}

fn draw_chart(
    f: &mut ratatui::Frame<'_>,
    area: ratatui::layout::Rect,
    points: &[u64],
    chart_rows: &[Value],
) {
    let inner = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(5), Constraint::Min(5)])
        .split(area);
    let spark = Sparkline::default()
        .block(Block::default().title("Trend").borders(Borders::ALL))
        .data(points);
    f.render_widget(spark, inner[0]);
    render_row_list(f, inner[1], "Recent rows", chart_rows, 0);
}

fn draw_table(
    f: &mut ratatui::Frame<'_>,
    area: ratatui::layout::Rect,
    table_rows: &[Value],
    scroll: usize,
) {
    render_row_list(
        f,
        area,
        "Table rows (j/k or ↑/↓ scroll)",
        table_rows,
        scroll,
    );
}

fn render_row_list(
    f: &mut ratatui::Frame<'_>,
    area: ratatui::layout::Rect,
    title: &str,
    rows: &[Value],
    scroll: usize,
) {
    let visible = area.height.saturating_sub(2) as usize;
    let rows_widget: Vec<Row> = rows
        .iter()
        .skip(scroll)
        .take(visible.max(1))
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
    let table = TuiTable::new(rows_widget, [Constraint::Percentage(100)])
        .block(Block::default().title(title).borders(Borders::ALL));
    f.render_widget(table, area);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_labels() {
        assert_eq!(TuiMode::Overview.label(), "overview");
        assert_eq!(TuiMode::Chart.label(), "chart");
        assert_eq!(TuiMode::Table.label(), "table");
    }

    #[test]
    fn host_id_clamps_at_zero() {
        let mut host_id: u32 = 0;
        host_id = host_id.saturating_sub(1);
        assert_eq!(host_id, 0);
        host_id = host_id.saturating_add(1);
        assert_eq!(host_id, 1);
    }
}
