//! Live dashboard TUI — the default `chm` product path.
//!
//! Alt-screen is entered only by this TUI (`chm` / `chm tui`) and interactive
//! `chm chat` (`tui/chat.rs`). Other commands must never call EnterAlternateScreen.

pub mod chat;

use std::{
    io,
    time::{Duration, Instant},
};

use anyhow::Result;
use crossterm::{
    event::{self, KeyCode, KeyEvent, KeyEventKind, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, Cell, Clear, List, ListItem, ListState, Paragraph, Row, Sparkline,
        Table as TuiTable, TableState, Wrap,
    },
    Frame, Terminal,
};
use reqwest::Client;
use serde_json::Value;

use crate::{
    client,
    config::{AppConfig, DEFAULT_TABLE},
    metrics, output,
};

const TUI_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
const TUI_EVENT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const COMBINED_MIN_WIDTH: u16 = 72;
const COMBINED_MIN_HEIGHT: u16 = 24;
const ORANGE: Color = Color::Rgb(249, 115, 22);
const EMERALD: Color = Color::Rgb(16, 185, 129);
const AUTH_HINT: &str = "Dashboard needs login — run `chm auth login`, then press r";
const HELP_TEXT: &str = "\
chmonitor keys

  q / Esc     quit
  r           refresh now
  ?           toggle this help
  a           open agent chat
  h / ←       previous host
  l / →       next host
  j / ↓       scroll table down
  k / ↑       scroll table up
  Tab         switch pane (small terminals)
  1           overview pane
  2 / 3       table pane
  /           filter table

Default chart is config `default_chart` (else query-count).
Default table is running-queries. Point --base-url / CHM_BASE_URL
at a self-hosted dashboard when not using dash.chmonitor.dev.";

const PREFERRED_TABLE_COLUMNS: &[&str] = &[
    "query_id",
    "user",
    "elapsed",
    "elapsed_ms",
    "read_rows",
    "memory_usage",
    "query",
    "query_kind",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pane {
    Overview,
    Table,
}

impl Pane {
    fn label(self) -> &'static str {
        match self {
            Pane::Overview => "overview",
            Pane::Table => "table",
        }
    }

    fn next(self) -> Self {
        match self {
            Pane::Overview => Pane::Table,
            Pane::Table => Pane::Overview,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Overlay {
    None,
    Help,
    Search { draft: String },
}

#[derive(Debug, Clone)]
struct HostEntry {
    id: u32,
    name: String,
    host: String,
}

pub struct TuiOptions<'a> {
    pub chart: &'a str,
    pub table: &'a str,
    pub page_size: usize,
    pub start_overview: bool,
    pub host_id: u32,
}

pub enum TuiExit {
    Quit,
    Chat { host_id: u32 },
}

struct TuiGuard;

impl Drop for TuiGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
    }
}

struct App {
    chart: String,
    table: String,
    page_size: usize,
    host_id: u32,
    hosts: Vec<HostEntry>,
    points: Vec<u64>,
    chart_rows: Vec<Value>,
    table_rows: Vec<Value>,
    table_scroll: usize,
    table_filter: String,
    focused: Pane,
    overlay: Overlay,
    error: Option<String>,
    auth_required: bool,
    last_ok_refresh: Option<Instant>,
}

impl App {
    fn new(opts: &TuiOptions<'_>) -> Self {
        Self {
            chart: opts.chart.to_string(),
            table: if opts.table.is_empty() {
                DEFAULT_TABLE.to_string()
            } else {
                opts.table.to_string()
            },
            page_size: opts.page_size,
            host_id: opts.host_id,
            hosts: Vec::new(),
            points: Vec::new(),
            chart_rows: Vec::new(),
            table_rows: Vec::new(),
            table_scroll: 0,
            table_filter: String::new(),
            focused: if opts.start_overview {
                Pane::Overview
            } else {
                Pane::Table
            },
            overlay: Overlay::None,
            error: None,
            auth_required: false,
            last_ok_refresh: None,
        }
    }

    fn host_label(&self) -> String {
        host_label(&self.hosts, self.host_id)
    }

    fn filtered_rows(&self) -> Vec<&Value> {
        filter_rows(&self.table_rows, &self.table_filter)
    }

    fn clamp_scroll(&mut self) {
        let max = self.filtered_rows().len().saturating_sub(1);
        if self.table_scroll > max {
            self.table_scroll = max;
        }
    }
}

pub async fn run(client: &Client, cfg: &AppConfig, opts: TuiOptions<'_>) -> Result<TuiExit> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let _guard = TuiGuard;

    let backend = ratatui::backend::CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new(&opts);
    let mut next_refresh_at = Instant::now();

    loop {
        if Instant::now() >= next_refresh_at {
            refresh(client, cfg, &mut app).await;
            next_refresh_at = Instant::now() + TUI_REFRESH_INTERVAL;
        }

        terminal.draw(|f| draw(f, cfg, &app))?;

        let poll_timeout = next_refresh_at
            .saturating_duration_since(Instant::now())
            .min(TUI_EVENT_POLL_INTERVAL);
        if !event::poll(poll_timeout)? {
            continue;
        }
        match event::read()? {
            event::Event::Resize(_, _) => continue,
            event::Event::Key(key) => match handle_key(&mut app, key) {
                KeyAction::None => {}
                KeyAction::Refresh => next_refresh_at = Instant::now(),
                KeyAction::Quit => return Ok(TuiExit::Quit),
                KeyAction::Chat => {
                    return Ok(TuiExit::Chat {
                        host_id: app.host_id,
                    });
                }
            },
            _ => {}
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KeyAction {
    None,
    Quit,
    Chat,
    Refresh,
}

fn handle_key(app: &mut App, key: KeyEvent) -> KeyAction {
    if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
        return KeyAction::None;
    }
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
        return KeyAction::Quit;
    }

    match &app.overlay {
        Overlay::Help => match key.code {
            KeyCode::Char('q') => KeyAction::Quit,
            KeyCode::Esc | KeyCode::Char('?') => {
                app.overlay = Overlay::None;
                KeyAction::None
            }
            _ => KeyAction::None,
        },
        Overlay::Search { draft } => {
            let mut draft = draft.clone();
            match key.code {
                KeyCode::Esc => {
                    app.overlay = Overlay::None;
                    KeyAction::None
                }
                KeyCode::Enter => {
                    app.table_filter = draft;
                    app.table_scroll = 0;
                    app.overlay = Overlay::None;
                    KeyAction::None
                }
                KeyCode::Backspace => {
                    draft.pop();
                    app.overlay = Overlay::Search { draft };
                    KeyAction::None
                }
                KeyCode::Char(c) => {
                    draft.push(c);
                    app.overlay = Overlay::Search { draft };
                    KeyAction::None
                }
                _ => KeyAction::None,
            }
        }
        Overlay::None => match key.code {
            KeyCode::Char('q') | KeyCode::Esc => {
                if !app.table_filter.is_empty() && key.code == KeyCode::Esc {
                    app.table_filter.clear();
                    app.table_scroll = 0;
                    KeyAction::None
                } else {
                    KeyAction::Quit
                }
            }
            KeyCode::Char('?') => {
                app.overlay = Overlay::Help;
                KeyAction::None
            }
            KeyCode::Char('r') => KeyAction::Refresh,
            KeyCode::Char('a') => KeyAction::Chat,
            KeyCode::Char('/') => {
                app.overlay = Overlay::Search {
                    draft: app.table_filter.clone(),
                };
                KeyAction::None
            }
            KeyCode::Char('1') => {
                app.focused = Pane::Overview;
                KeyAction::None
            }
            KeyCode::Char('2') | KeyCode::Char('3') => {
                app.focused = Pane::Table;
                KeyAction::None
            }
            KeyCode::Tab => {
                app.focused = app.focused.next();
                KeyAction::None
            }
            KeyCode::Char('h') | KeyCode::Char('[') | KeyCode::Left => {
                app.host_id = step_host(&app.hosts, app.host_id, -1);
                KeyAction::Refresh
            }
            KeyCode::Char('l') | KeyCode::Char(']') | KeyCode::Right => {
                app.host_id = step_host(&app.hosts, app.host_id, 1);
                KeyAction::Refresh
            }
            KeyCode::Down | KeyCode::Char('j') => {
                let max = app.filtered_rows().len().saturating_sub(1);
                app.table_scroll = (app.table_scroll + 1).min(max);
                KeyAction::None
            }
            KeyCode::Up | KeyCode::Char('k') => {
                app.table_scroll = app.table_scroll.saturating_sub(1);
                KeyAction::None
            }
            _ => KeyAction::None,
        },
    }
}

async fn refresh(client: &Client, cfg: &AppConfig, app: &mut App) {
    let base = cfg.base_url.trim_end_matches('/');
    let hosts_url = format!("{base}/api/v1/hosts");
    let chart_url = format!("{base}/api/v1/charts/{}?hostId={}", app.chart, app.host_id);
    let table_url = format!(
        "{base}/api/v1/tables/{}?hostId={}&pageSize={}",
        app.table, app.host_id, app.page_size
    );

    let (hosts_res, chart_res, table_res) = tokio::join!(
        client::fetch_cfg(client, cfg, hosts_url),
        client::fetch_cfg(client, cfg, chart_url),
        client::fetch_cfg(client, cfg, table_url),
    );

    let mut auth = false;
    let mut errors: Vec<String> = Vec::new();

    match hosts_res {
        Ok(data) => app.hosts = parse_hosts(&data),
        Err(err) => {
            auth |= is_auth_error(&err);
            errors.push(short_error("hosts", &err));
        }
    }

    match chart_res {
        Ok(data) => match client::rows_from_chart_data(data) {
            Ok(rows) => {
                app.points = rows.iter().take(80).map(metrics::row_metric).collect();
                app.chart_rows = rows;
            }
            Err(err) => errors.push(short_error("chart", &err)),
        },
        Err(err) => {
            auth |= is_auth_error(&err);
            errors.push(short_error("chart", &err));
        }
    }

    match table_res {
        Ok(data) => {
            app.table_rows = match data {
                Value::Array(rows) => rows,
                other => vec![other],
            };
            app.clamp_scroll();
        }
        Err(err) => {
            auth |= is_auth_error(&err);
            errors.push(short_error("table", &err));
        }
    }

    if auth {
        app.auth_required = true;
        app.error = Some(AUTH_HINT.to_string());
    } else if let Some(message) = errors.into_iter().next() {
        app.auth_required = false;
        app.error = Some(message);
    } else {
        app.auth_required = false;
        app.error = None;
        app.last_ok_refresh = Some(Instant::now());
    }
}

fn draw(f: &mut Frame<'_>, cfg: &AppConfig, app: &App) {
    let area = f.area();
    let combined = use_combined_layout(area.width, area.height);
    let show_banner = app.error.is_some();
    let show_switcher = !combined;

    let mut constraints = vec![Constraint::Length(3)];
    if show_banner {
        constraints.push(Constraint::Length(3));
    }
    if show_switcher {
        constraints.push(Constraint::Length(1));
    }
    constraints.push(Constraint::Min(5));
    constraints.push(Constraint::Length(1));

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(constraints)
        .split(area);

    let mut idx = 0;
    draw_header(f, chunks[idx], cfg, app, combined);
    idx += 1;
    if show_banner {
        draw_banner(f, chunks[idx], app);
        idx += 1;
    }
    if show_switcher {
        draw_switcher(f, chunks[idx], app.focused);
        idx += 1;
    }
    let body = chunks[idx];
    let footer = chunks[idx + 1];

    if combined {
        draw_combined(f, body, app);
    } else {
        match app.focused {
            Pane::Overview => draw_overview(f, body, app),
            Pane::Table => draw_table_pane(f, body, app),
        }
    }

    f.render_widget(
        Paragraph::new(footer_hints(combined, &app.overlay, &app.table_filter))
            .style(Style::default().fg(Color::DarkGray)),
        footer,
    );

    match &app.overlay {
        Overlay::Help => draw_help(f, area),
        Overlay::Search { .. } | Overlay::None => {}
    }
}

fn draw_header(f: &mut Frame<'_>, area: Rect, cfg: &AppConfig, app: &App, combined: bool) {
    let age = refresh_age_label(app.last_ok_refresh, Instant::now());
    let age_style = if age == "live" {
        Style::default()
            .fg(EMERALD)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::DarkGray)
    };
    let layout = if combined {
        "live"
    } else {
        app.focused.label()
    };
    let line = Line::from(vec![
        Span::styled(
            " chmonitor ",
            Style::default()
                .fg(ORANGE)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" "),
        Span::styled(
            app.host_label(),
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw("  "),
        Span::styled(
            short_base_url(&cfg.base_url),
            Style::default().fg(Color::DarkGray),
        ),
        Span::raw("  "),
        Span::raw(cfg.channel.as_str().to_string()),
        Span::raw("  "),
        Span::styled(age, age_style),
        Span::raw("  "),
        Span::styled(layout, Style::default().fg(Color::DarkGray)),
    ]);
    f.render_widget(Paragraph::new(line).block(Block::bordered()), area);
}

fn draw_banner(f: &mut Frame<'_>, area: Rect, app: &App) {
    let style = if app.auth_required {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default().fg(Color::Red)
    };
    let text = app.error.as_deref().unwrap_or("");
    f.render_widget(
        Paragraph::new(text)
            .style(style)
            .wrap(Wrap { trim: true })
            .block(Block::bordered().title("status")),
        area,
    );
}

fn draw_switcher(f: &mut Frame<'_>, area: Rect, focused: Pane) {
    f.render_widget(pane_switcher_line(focused), area);
}

fn draw_combined(f: &mut Frame<'_>, area: Rect, app: &App) {
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(24), Constraint::Min(40)])
        .split(area);
    draw_hosts(f, cols[0], app);
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(7), Constraint::Min(6)])
        .split(cols[1]);
    draw_chart(f, rows[0], app);
    draw_table_pane(f, rows[1], app);
}

fn draw_overview(f: &mut Frame<'_>, area: Rect, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(38), Constraint::Percentage(62)])
        .split(area);
    draw_hosts(f, chunks[0], app);
    draw_chart(f, chunks[1], app);
}

fn draw_hosts(f: &mut Frame<'_>, area: Rect, app: &App) {
    if app.hosts.is_empty() {
        let body = if app.auth_required {
            "sign in to list hosts"
        } else {
            "loading…"
        };
        f.render_widget(
            Paragraph::new(body).block(Block::bordered().title("hosts")),
            area,
        );
        return;
    }
    let items: Vec<ListItem> = app
        .hosts
        .iter()
        .map(|h| {
            let extra = if h.host.is_empty() || h.host == h.name {
                String::new()
            } else {
                format!("  {}", h.host)
            };
            ListItem::new(format!("{}  {}{extra}", h.id, h.name))
        })
        .collect();
    let mut state = ListState::default();
    if let Some(idx) = app.hosts.iter().position(|h| h.id == app.host_id) {
        state.select(Some(idx));
    }
    let list = List::new(items)
        .block(Block::bordered().title(format!("hosts  {}", app.hosts.len())))
        .highlight_symbol("● ")
        .highlight_style(
            Style::default()
                .fg(ORANGE)
                .add_modifier(Modifier::BOLD),
        );
    f.render_stateful_widget(list, area, &mut state);
}

fn draw_chart(f: &mut Frame<'_>, area: Rect, app: &App) {
    let stats = output::sparkline_stats(&app.points).unwrap_or_else(|| "no data".into());
    let title = format!("{}  {stats}", app.chart);
    if app.points.is_empty() {
        f.render_widget(
            Paragraph::new(if app.auth_required {
                "sign in to load chart"
            } else {
                "no chart data"
            })
            .block(Block::bordered().title(title)),
            area,
        );
        return;
    }
    let spark = Sparkline::default()
        .block(Block::bordered().title(title))
        .data(&app.points)
        .style(Style::default().fg(ORANGE));
    f.render_widget(spark, area);
}

fn draw_table_pane(f: &mut Frame<'_>, area: Rect, app: &App) {
    let filtered = app.filtered_rows();
    let total = app.table_rows.len();
    let shown = filtered.len();
    let filter_bit = if app.table_filter.is_empty() {
        String::new()
    } else {
        format!("  /{}", app.table_filter)
    };
    let title = format!("{}  {shown}/{total}{filter_bit}", app.table);

    if filtered.is_empty() {
        let body = if app.auth_required {
            "sign in to load table"
        } else if total == 0 {
            "no rows"
        } else {
            "no rows match filter"
        };
        f.render_widget(
            Paragraph::new(body).block(Block::bordered().title(title)),
            area,
        );
        return;
    }

    let cols = table_columns(filtered.first().copied().unwrap_or(&Value::Null));
    if cols.is_empty() {
        f.render_widget(
            Paragraph::new("no columns").block(Block::bordered().title(title)),
            area,
        );
        return;
    }

    let header = Row::new(cols.iter().cloned().map(Cell::from)).style(
        Style::default()
            .fg(ORANGE)
            .add_modifier(Modifier::BOLD),
    );
    let widths = column_constraints(cols.len());
    let rows: Vec<Row> = filtered
        .iter()
        .map(|row| {
            let obj = row.as_object();
            Row::new(cols.iter().map(|col| {
                let raw = obj
                    .and_then(|o| o.get(col))
                    .map(cell_text)
                    .unwrap_or_default();
                Cell::from(truncate_chars(&raw, 48))
            }))
        })
        .collect();

    let mut state = TableState::default();
    state.select(Some(app.table_scroll));
    let table = TuiTable::new(rows, widths)
        .header(header)
        .block(Block::bordered().title(title))
        .row_highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▸ ");
    f.render_stateful_widget(table, area, &mut state);
}

fn draw_help(f: &mut Frame<'_>, area: Rect) {
    let popup = centered_rect(70, 70, area);
    f.render_widget(Clear, popup);
    f.render_widget(
        Paragraph::new(HELP_TEXT)
            .wrap(Wrap { trim: false })
            .block(Block::bordered().title("help  ?/Esc close  q quit")),
        popup,
    );
}

fn pane_switcher_line(focused: Pane) -> Line<'static> {
    let (ov_style, tb_style) = match focused {
        Pane::Overview => (
            Style::default()
                .fg(ORANGE)
                .add_modifier(Modifier::BOLD | Modifier::REVERSED),
            Style::default().fg(Color::DarkGray),
        ),
        Pane::Table => (
            Style::default().fg(Color::DarkGray),
            Style::default()
                .fg(ORANGE)
                .add_modifier(Modifier::BOLD | Modifier::REVERSED),
        ),
    };
    Line::from(vec![
        Span::raw(" "),
        Span::styled(" overview ", ov_style),
        Span::raw("  "),
        Span::styled(" table ", tb_style),
        Span::styled("   tab to switch", Style::default().fg(Color::DarkGray)),
    ])
}

fn footer_hints(combined: bool, overlay: &Overlay, filter: &str) -> String {
    match overlay {
        Overlay::Help => " ?/Esc close help   q quit".into(),
        Overlay::Search { draft } => format!(" /{draft}   Enter apply   Esc cancel"),
        Overlay::None if !filter.is_empty() => {
            format!(" filter={filter}  Esc clear  │  q quit  r refresh  h/l host  j/k scroll  a chat  ? help")
        }
        Overlay::None if combined => {
            " q quit  r refresh  h/l host  j/k scroll  a chat  / find  ? help".into()
        }
        Overlay::None => {
            " q quit  r refresh  tab pane  h/l host  j/k scroll  a chat  / find  ? help".into()
        }
    }
}

fn use_combined_layout(width: u16, height: u16) -> bool {
    width >= COMBINED_MIN_WIDTH && height >= COMBINED_MIN_HEIGHT
}

fn short_base_url(url: &str) -> String {
    url.trim()
        .trim_end_matches('/')
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .to_string()
}

fn refresh_age_label(last_ok: Option<Instant>, now: Instant) -> String {
    match last_ok {
        None => "…".into(),
        Some(t) => {
            let secs = now.saturating_duration_since(t).as_secs();
            if secs < 2 {
                "live".into()
            } else {
                format!("{secs}s ago")
            }
        }
    }
}

fn host_label(hosts: &[HostEntry], host_id: u32) -> String {
    hosts
        .iter()
        .find(|h| h.id == host_id)
        .map(|h| {
            if h.name.is_empty() {
                format!("host {host_id}")
            } else {
                h.name.clone()
            }
        })
        .unwrap_or_else(|| format!("host {host_id}"))
}

fn step_host(hosts: &[HostEntry], current: u32, dir: i32) -> u32 {
    if hosts.is_empty() {
        return if dir < 0 {
            current.saturating_sub(1)
        } else {
            current.saturating_add(1)
        };
    }
    let idx = hosts.iter().position(|h| h.id == current).unwrap_or(0);
    let n = hosts.len() as i32;
    let next = (idx as i32 + dir).rem_euclid(n) as usize;
    hosts[next].id
}

fn parse_hosts(data: &Value) -> Vec<HostEntry> {
    let Some(arr) = data.as_array() else {
        return Vec::new();
    };
    arr.iter()
        .enumerate()
        .map(|(i, v)| {
            let obj = v.as_object();
            let id = obj
                .and_then(|o| o.get("id"))
                .and_then(Value::as_u64)
                .unwrap_or(i as u64) as u32;
            let name = obj
                .and_then(|o| o.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let host = obj
                .and_then(|o| o.get("host"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let name = if name.is_empty() {
                if host.is_empty() {
                    format!("host {id}")
                } else {
                    host.clone()
                }
            } else {
                name
            };
            HostEntry { id, name, host }
        })
        .collect()
}

fn is_auth_error(err: &anyhow::Error) -> bool {
    let msg = err.to_string();
    msg.contains("HTTP 401") || msg.contains("HTTP 403") || msg.contains("chm auth login")
}

fn short_error(scope: &str, err: &anyhow::Error) -> String {
    let msg = err.to_string().replace('\n', " ");
    let clipped = client::truncate_body(&msg, 160).unwrap_or_default();
    format!("{scope}: {clipped}")
}

fn cell_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        other => other.to_string(),
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    if max == 0 {
        return String::new();
    }
    let mut chars = s.chars();
    let head: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

fn table_columns(row: &Value) -> Vec<String> {
    let Some(obj) = row.as_object() else {
        return Vec::new();
    };
    let mut cols: Vec<String> = PREFERRED_TABLE_COLUMNS
        .iter()
        .filter(|key| obj.contains_key(**key))
        .map(|key| (*key).to_string())
        .collect();
    for key in obj.keys() {
        if !cols.iter().any(|c| c == key) {
            cols.push(key.clone());
        }
    }
    cols.truncate(8);
    cols
}

fn filter_rows<'a>(rows: &'a [Value], filter: &str) -> Vec<&'a Value> {
    let needle = filter.trim();
    if needle.is_empty() {
        return rows.iter().collect();
    }
    let needle = needle.to_ascii_lowercase();
    rows.iter()
        .filter(|row| {
            row.as_object()
                .map(|obj| {
                    obj.values()
                        .any(|v| cell_text(v).to_ascii_lowercase().contains(&needle))
                })
                .unwrap_or(false)
        })
        .collect()
}

fn column_constraints(n: usize) -> Vec<Constraint> {
    if n == 0 {
        return vec![Constraint::Percentage(100)];
    }
    let each = (100 / n as u16).max(1);
    (0..n)
        .map(|i| {
            if i + 1 == n {
                Constraint::Min(12)
            } else {
                Constraint::Percentage(each.min(28))
            }
        })
        .collect()
}

fn centered_rect(percent_x: u16, percent_y: u16, area: Rect) -> Rect {
    let popup = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(area);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup[1])[1]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    #[test]
    fn pane_labels_and_cycle() {
        assert_eq!(Pane::Overview.label(), "overview");
        assert_eq!(Pane::Table.label(), "table");
        assert_eq!(Pane::Overview.next(), Pane::Table);
        assert_eq!(Pane::Table.next(), Pane::Overview);
    }

    #[test]
    fn combined_layout_needs_room() {
        assert!(use_combined_layout(80, 30));
        assert!(!use_combined_layout(40, 40));
        assert!(!use_combined_layout(80, 10));
        assert!(!use_combined_layout(71, 24));
        assert!(use_combined_layout(72, 24));
    }

    #[test]
    fn short_base_url_strips_scheme() {
        assert_eq!(
            short_base_url("https://dash.chmonitor.dev/"),
            "dash.chmonitor.dev"
        );
        assert_eq!(short_base_url("http://127.0.0.1:3000"), "127.0.0.1:3000");
        assert_eq!(short_base_url("dash.chmonitor.dev"), "dash.chmonitor.dev");
    }

    #[test]
    fn refresh_age_is_live_under_two_seconds() {
        let now = Instant::now();
        assert_eq!(refresh_age_label(None, now), "…");
        assert_eq!(refresh_age_label(Some(now), now), "live");
        assert_eq!(
            refresh_age_label(Some(now - Duration::from_secs(5)), now),
            "5s ago"
        );
    }

    #[test]
    fn parse_hosts_reads_id_name_host() {
        let data = json!([
            {"id": 0, "name": "prod", "host": "ch.example:8123"},
            {"id": 2, "name": "staging", "host": "stg:8123"}
        ]);
        let hosts = parse_hosts(&data);
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].id, 0);
        assert_eq!(hosts[0].name, "prod");
        assert_eq!(hosts[1].id, 2);
        assert_eq!(host_label(&hosts, 2), "staging");
        assert_eq!(host_label(&hosts, 9), "host 9");
    }

    #[test]
    fn step_host_cycles_known_ids() {
        let hosts = parse_hosts(&json!([
            {"id": 0, "name": "a"},
            {"id": 4, "name": "b"},
            {"id": 7, "name": "c"}
        ]));
        assert_eq!(step_host(&hosts, 0, 1), 4);
        assert_eq!(step_host(&hosts, 7, 1), 0);
        assert_eq!(step_host(&hosts, 0, -1), 7);
        assert_eq!(step_host(&[], 0, -1), 0);
        assert_eq!(step_host(&[], 0, 1), 1);
    }

    #[test]
    fn auth_error_detects_http_status() {
        assert!(is_auth_error(&anyhow::anyhow!(
            "chmonitor API returned HTTP 401 for https://dash.chmonitor.dev/api/v1/hosts"
        )));
        assert!(is_auth_error(&anyhow::anyhow!("HTTP 403 Check --api-key")));
        assert!(is_auth_error(&anyhow::anyhow!("run `chm auth login`")));
        assert!(!is_auth_error(&anyhow::anyhow!("HTTP 500")));
    }

    #[test]
    fn cell_text_strips_json_quotes() {
        assert_eq!(cell_text(&json!("hello")), "hello");
        assert_eq!(cell_text(&json!(12)), "12");
        assert_eq!(cell_text(&json!(true)), "true");
        assert_eq!(cell_text(&json!(null)), "");
    }

    #[test]
    fn table_columns_prefer_running_query_fields() {
        let row = json!({
            "memory_usage": 1,
            "query": "SELECT 1",
            "query_id": "abc",
            "user": "default",
            "extra": 0
        });
        let cols = table_columns(&row);
        assert_eq!(cols[0], "query_id");
        assert_eq!(cols[1], "user");
        assert!(cols.contains(&"query".to_string()));
        assert!(cols.contains(&"extra".to_string()));
        assert!(cols.len() <= 8);
    }

    #[test]
    fn filter_rows_is_case_insensitive() {
        let rows = vec![
            json!({"user": "alice", "query": "SELECT 1"}),
            json!({"user": "bob", "query": "optimize table"}),
        ];
        assert_eq!(filter_rows(&rows, "").len(), 2);
        assert_eq!(filter_rows(&rows, "BOB").len(), 1);
        assert_eq!(filter_rows(&rows, "select").len(), 1);
        assert!(filter_rows(&rows, "zzz").is_empty());
    }

    #[test]
    fn footer_mentions_real_keys() {
        let hints = footer_hints(true, &Overlay::None, "");
        assert!(hints.contains("q quit"), "{hints}");
        assert!(hints.contains("r refresh"), "{hints}");
        assert!(hints.contains("? help"), "{hints}");
        assert!(hints.contains("a chat"), "{hints}");
        let small = footer_hints(false, &Overlay::None, "");
        assert!(small.contains("tab pane"), "{small}");
    }

    #[test]
    fn question_mark_opens_help_and_slash_opens_search() {
        let opts = TuiOptions {
            chart: "query-count",
            table: "running-queries",
            page_size: 15,
            start_overview: false,
            host_id: 0,
        };
        let mut app = App::new(&opts);
        assert_eq!(app.focused, Pane::Table);
        assert_eq!(
            handle_key(&mut app, key(KeyCode::Char('?'))),
            KeyAction::None
        );
        assert!(matches!(app.overlay, Overlay::Help));
        assert_eq!(
            handle_key(&mut app, key(KeyCode::Char('?'))),
            KeyAction::None
        );
        assert!(matches!(app.overlay, Overlay::None));
        assert_eq!(
            handle_key(&mut app, key(KeyCode::Char('/'))),
            KeyAction::None
        );
        match &app.overlay {
            Overlay::Search { draft } => assert!(draft.is_empty()),
            other => panic!("expected search, got {other:?}"),
        }
        assert_eq!(
            handle_key(&mut app, key(KeyCode::Char('a'))),
            KeyAction::None
        );
        assert_eq!(handle_key(&mut app, key(KeyCode::Enter)), KeyAction::None);
        assert_eq!(app.table_filter, "a");
        assert_eq!(
            handle_key(&mut app, key(KeyCode::Char('a'))),
            KeyAction::Chat
        );
        assert_eq!(
            handle_key(&mut app, key(KeyCode::Char('q'))),
            KeyAction::Quit
        );
    }

    #[test]
    fn host_keys_request_refresh() {
        let opts = TuiOptions {
            chart: "query-count",
            table: "running-queries",
            page_size: 15,
            start_overview: true,
            host_id: 0,
        };
        let mut app = App::new(&opts);
        app.hosts = parse_hosts(&json!([{"id":0,"name":"a"},{"id":1,"name":"b"}]));
        assert_eq!(
            handle_key(&mut app, key(KeyCode::Char('l'))),
            KeyAction::Refresh
        );
        assert_eq!(app.host_id, 1);
        assert_eq!(handle_key(&mut app, key(KeyCode::Left)), KeyAction::Refresh);
        assert_eq!(app.host_id, 0);
        assert_eq!(
            handle_key(&mut app, key(KeyCode::Char('r'))),
            KeyAction::Refresh
        );
        assert_eq!(handle_key(&mut app, key(KeyCode::Tab)), KeyAction::None);
        assert_eq!(app.focused, Pane::Table);
    }

    #[test]
    fn default_table_matches_config() {
        assert_eq!(crate::config::DEFAULT_TABLE, "running-queries");
        assert_eq!(crate::config::DEFAULT_CHART, "query-count");
    }
}
