use std::{
    collections::HashMap,
    fs, io,
    path::PathBuf,
    time::{Duration, Instant},
};

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use comfy_table::{presets::UTF8_FULL, Table};
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
use serde::{Deserialize, Serialize};
use serde_json::Value;

mod diagnose;
mod telemetry;
mod update;

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
struct FileConfig {
    base_url: Option<String>,
    host_id: Option<u32>,
    api_key: Option<String>,
    default_chart: Option<String>,
}

#[derive(Parser, Debug)]
#[command(name = "chm", version, about = "chmonitor CLI")]
struct Cli {
    #[arg(long, env = "CHM_CONFIG")]
    config: Option<PathBuf>,
    #[arg(long, env = "CHM_BASE_URL")]
    base_url: Option<String>,
    #[arg(long, env = "CHM_HOST_ID")]
    host_id: Option<u32>,
    #[arg(long, env = "CHM_API_KEY")]
    api_key: Option<String>,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    Hosts,
    Chart {
        name: String,
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    Table {
        name: String,
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    Tui {
        chart: Option<String>,
    },
    /// Zero-signup local diagnostics: connect directly to a ClickHouse host
    /// (no chmonitor account/backend needed) and print a scored health report.
    Diagnose {
        /// ClickHouse HTTP interface URL, e.g. http://localhost:8123
        #[arg(long, env = "CLICKHOUSE_HOST")]
        ch_host: Option<String>,
        #[arg(long, env = "CLICKHOUSE_USER", default_value = "default")]
        ch_user: String,
        #[arg(long, env = "CLICKHOUSE_PASSWORD", default_value = "")]
        ch_password: String,
        #[arg(long, env = "CLICKHOUSE_DATABASE", default_value = "default")]
        ch_database: String,
        /// Print the report as JSON instead of a table.
        #[arg(long)]
        json: bool,
    },
    /// Update chm to the latest release from GitHub (self-update).
    Update {
        /// Only check whether an update is available; exit 1 if one exists.
        #[arg(long)]
        check: bool,
        /// Install a specific release tag, e.g. chm-v0.2.0.
        #[arg(long)]
        version: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
struct ApiResponse {
    data: Value,
}

#[derive(Debug, Clone)]
struct AppConfig {
    base_url: String,
    host_id: u32,
    api_key: Option<String>,
    default_chart: String,
}

fn default_config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".config/chm/config.toml"))
}

fn load_file_config(path: Option<PathBuf>) -> Result<FileConfig> {
    let p = path.or_else(default_config_path);
    if let Some(path) = p {
        if path.exists() {
            let content = fs::read_to_string(&path)
                .with_context(|| format!("failed to read config at {}", path.display()))?;
            let cfg = toml::from_str(&content)
                .with_context(|| format!("failed to parse config at {}", path.display()))?;
            return Ok(cfg);
        }
    }
    Ok(FileConfig::default())
}

fn resolve_config(cli: &Cli) -> Result<AppConfig> {
    let file = load_file_config(cli.config.clone())?;
    Ok(AppConfig {
        base_url: cli
            .base_url
            .clone()
            .or(file.base_url)
            .unwrap_or_else(|| "http://localhost:3000".to_string()),
        host_id: cli.host_id.or(file.host_id).unwrap_or(0),
        api_key: cli.api_key.clone().or(file.api_key),
        default_chart: file
            .default_chart
            .unwrap_or_else(|| "query-count".to_string()),
    })
}

async fn fetch(client: &Client, url: String, api_key: Option<&str>) -> Result<Value> {
    let mut req = client.get(url);
    if let Some(k) = api_key {
        req = req.header("x-api-key", k);
    }
    let resp = req.send().await?.error_for_status()?;
    let parsed: ApiResponse = resp.json().await?;
    Ok(parsed.data)
}

fn rows_from_chart_data(data: Value) -> Result<Vec<Value>> {
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

const TUI_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
const TUI_EVENT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const PREFERRED_METRIC_KEYS: &[&str] = &["count", "query_count", "value", "total"];

fn metric_from_float(value: f64) -> Option<u64> {
    if value.is_finite() && value >= 0.0 && value <= u64::MAX as f64 {
        Some(value.round() as u64)
    } else {
        None
    }
}

fn value_metric(value: &Value) -> Option<u64> {
    match value {
        Value::Number(number) => number
            .as_u64()
            .or_else(|| number.as_i64().and_then(|n| u64::try_from(n).ok()))
            .or_else(|| number.as_f64().and_then(metric_from_float)),
        Value::String(text) => text
            .trim()
            .parse::<u64>()
            .ok()
            .or_else(|| text.trim().parse::<f64>().ok().and_then(metric_from_float)),
        _ => None,
    }
}

fn row_metric(row: &Value) -> u64 {
    row.as_object()
        .and_then(|o| {
            PREFERRED_METRIC_KEYS
                .iter()
                .find_map(|key| o.get(*key).and_then(value_metric))
                .or_else(|| o.values().find_map(value_metric))
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn row_metric_prefers_known_metric_keys() {
        let row = json!({
            "duration_ms": 9000,
            "query_count": 42,
        });

        assert_eq!(row_metric(&row), 42);
    }

    #[test]
    fn row_metric_handles_float_and_string_values() {
        assert_eq!(row_metric(&json!({ "value": 12.6 })), 13);
        assert_eq!(row_metric(&json!({ "value": "7.4" })), 7);
    }

    #[test]
    fn row_metric_ignores_negative_or_invalid_values() {
        assert_eq!(row_metric(&json!({ "value": -1 })), 0);
        assert_eq!(row_metric(&json!({ "value": "not-a-number" })), 0);
    }
}

fn print_records(data: &[HashMap<String, Value>], limit: usize) {
    let mut table = Table::new();
    table.load_preset(UTF8_FULL);
    if let Some(first) = data.first() {
        let headers: Vec<String> = first.keys().cloned().collect();
        table.set_header(headers.clone());
        for row in data.iter().take(limit) {
            let cells = headers
                .iter()
                .map(|k| row.get(k).map_or("".into(), |v| v.to_string()))
                .collect::<Vec<_>>();
            table.add_row(cells);
        }
    }
    println!("{table}");
}

struct TuiGuard;

impl Drop for TuiGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
    }
}

async fn run_tui(client: &Client, cfg: &AppConfig, chart: &str) -> Result<()> {
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

    loop {
        let now = Instant::now();
        if now >= next_refresh_at {
            let url = format!(
                "{}/api/v1/charts/{}?hostId={}",
                cfg.base_url, chart, cfg.host_id
            );
            let rows_result = fetch(client, url, cfg.api_key.as_deref())
                .await
                .and_then(rows_from_chart_data);
            error_message = rows_result.as_ref().err().map(ToString::to_string);
            rows = rows_result.unwrap_or_default();
            points = rows.iter().take(80).map(row_metric).collect();
            next_refresh_at = Instant::now() + TUI_REFRESH_INTERVAL;
        }

        terminal.draw(|f| {
            let chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Length(3), Constraint::Min(5)].as_ref())
                .split(f.area());
            f.render_widget(
                Paragraph::new(format!(
                    "chm tui | chart={chart} | q=quit | r=refresh | host={}{}",
                    cfg.host_id,
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

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let cfg = resolve_config(&cli)?;
    let client = Client::builder().timeout(Duration::from_secs(20)).build()?;

    // Anonymous, opt-out CLI telemetry (source=cli). Fires in the background and
    // never blocks or fails the command; see src/telemetry.rs.
    let (tel_event, tel_command): (&'static str, &'static str) = match &cli.command {
        Commands::Diagnose { .. } => ("cli_diagnose", "diagnose"),
        Commands::Hosts => ("cli_run", "hosts"),
        Commands::Chart { .. } => ("cli_run", "chart"),
        Commands::Table { .. } => ("cli_run", "table"),
        Commands::Tui { .. } => ("cli_run", "tui"),
        Commands::Update { .. } => ("cli_run", "update"),
    };
    let tel_handle = telemetry::spawn(tel_event, tel_command);

    match cli.command {
        Commands::Hosts => {
            let url = format!("{}/api/v1/hosts", cfg.base_url);
            let data = fetch(&client, url, cfg.api_key.as_deref()).await?;
            let hosts: Vec<HashMap<String, Value>> =
                serde_json::from_value(data).context("hosts payload parse failed")?;
            print_records(&hosts, 100);
        }
        Commands::Chart { name, limit } => {
            let url = format!(
                "{}/api/v1/charts/{}?hostId={}",
                cfg.base_url, name, cfg.host_id
            );
            let data = fetch(&client, url, cfg.api_key.as_deref()).await?;
            let data = Value::Array(rows_from_chart_data(data)?);
            let rows: Vec<HashMap<String, Value>> =
                serde_json::from_value(data).context("chart payload parse failed")?;
            print_records(&rows, limit);
        }
        Commands::Table { name, limit } => {
            let url = format!(
                "{}/api/v1/tables/{}?hostId={}&pageSize={}",
                cfg.base_url, name, cfg.host_id, limit
            );
            let data = fetch(&client, url, cfg.api_key.as_deref()).await?;
            let rows: Vec<HashMap<String, Value>> =
                serde_json::from_value(data).context("table payload parse failed")?;
            print_records(&rows, limit);
        }
        Commands::Tui { chart } => {
            let c = chart.unwrap_or(cfg.default_chart.clone());
            run_tui(&client, &cfg, &c).await?
        }
        Commands::Diagnose {
            ch_host,
            ch_user,
            ch_password,
            ch_database,
            json,
        } => {
            let Some(raw_host) = ch_host else {
                bail!(
                    "no ClickHouse host given — pass --ch-host or set CLICKHOUSE_HOST \
                     (e.g. CLICKHOUSE_HOST=http://localhost:8123 chm diagnose)"
                );
            };
            // Multi-host clusters use a comma-separated CLICKHOUSE_HOST (same env var
            // the dashboard reads); this zero-signup CLI diagnoses one host at a time.
            let first_host = raw_host
                .split(',')
                .next()
                .map(str::trim)
                .filter(|h| !h.is_empty())
                .unwrap_or(&raw_host);
            if raw_host.contains(',') {
                eprintln!(
                    "note: CLICKHOUSE_HOST has multiple hosts — diagnosing only the first ({first_host}). Use the dashboard for multi-host clusters."
                );
            }
            let url = if first_host.starts_with("http://") || first_host.starts_with("https://") {
                first_host.to_string()
            } else {
                format!("http://{first_host}")
            };

            let ch_cfg = diagnose::ChConfig {
                url,
                user: ch_user,
                password: ch_password,
                database: ch_database,
            };
            let report = diagnose::run_diagnostics(&client, &ch_cfg).await?;
            if json {
                println!("{}", diagnose::render_json(&report)?);
            } else {
                print!("{}", diagnose::render_text(&report));
            }
            // Gentle, best-effort "update available" hint (opt out with
            // CHM_NO_UPDATE_CHECK=1). Never fails the command.
            update::hint(&client).await;
            if report
                .findings
                .iter()
                .any(|f| f.severity == diagnose::Severity::Critical)
            {
                telemetry::finish(tel_handle).await;
                std::process::exit(1);
            }
        }
        Commands::Update { check, version } => {
            if check {
                let available = update::check(&client).await?;
                if available {
                    std::process::exit(1);
                }
            } else {
                update::run(&client, version).await?;
            }
        }
    }

    telemetry::finish(tel_handle).await;
    Ok(())
}
