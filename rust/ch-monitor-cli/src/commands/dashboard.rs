//! `chm dashboard list` / `chm dashboard open`.

use std::io::{self, IsTerminal, Write};

use anyhow::{bail, Result};
use crossterm::{
    cursor,
    event::{self, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, Clear, ClearType},
};
use reqwest::Client;
use serde_json::json;

use crate::{
    cli::DashboardCommand,
    client,
    config::AppConfig,
    dashboards::{self, DashboardEntry},
    output,
};

pub async fn run(client: &Client, cfg: &AppConfig, command: DashboardCommand) -> Result<i32> {
    match command {
        DashboardCommand::List => list(client, cfg).await,
        DashboardCommand::Open { name } => open(client, cfg, &name).await,
    }
}

async fn load_entries(client: &Client, cfg: &AppConfig) -> (Vec<DashboardEntry>, Option<String>) {
    let mut entries = vec![DashboardEntry::overview()];
    let url = format!("{}/api/dashboards/list", cfg.base_url.trim_end_matches('/'));
    match client::fetch_status_cfg(client, cfg, url).await {
        Ok((status, body)) if (200..300).contains(&status) => {
            match serde_json::from_str::<serde_json::Value>(&body) {
                Ok(v) => {
                    let data = v.get("data").unwrap_or(&v);
                    entries.extend(dashboards::parse_saved_dashboards(data));
                    (entries, None)
                }
                Err(err) => (
                    entries,
                    Some(format!("saved dashboards: invalid JSON ({err})")),
                ),
            }
        }
        Ok((status, body)) => (entries, Some(dashboards::format_list_reason(status, &body))),
        Err(err) => (
            entries,
            Some(format!(
                "saved dashboards unavailable: {}",
                err.to_string().replace('\n', " ")
            )),
        ),
    }
}

async fn list(client: &Client, cfg: &AppConfig) -> Result<i32> {
    let (entries, reason) = load_entries(client, cfg).await;
    if cfg.json || !wants_picker() {
        return print_list(&entries, reason.as_deref(), cfg.json);
    }
    if let Some(reason) = &reason {
        output::warn(reason);
    }
    match pick(&entries)? {
        Some(idx) => open_entry(client, cfg, &entries[idx]).await,
        None => Ok(0),
    }
}

async fn open(client: &Client, cfg: &AppConfig, name: &str) -> Result<i32> {
    let (entries, reason) = load_entries(client, cfg).await;
    let Some(entry) = dashboards::find_dashboard(&entries, name).cloned() else {
        if let Some(reason) = reason {
            output::warn(&reason);
        }
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        bail!(
            "unknown dashboard '{name}'. Available: {}",
            names.join(", ")
        );
    };
    if let Some(reason) = reason {
        if entry.source == "builtin" {
            output::warn(&reason);
        }
    }
    open_entry(client, cfg, &entry).await
}

async fn open_entry(client: &Client, cfg: &AppConfig, entry: &DashboardEntry) -> Result<i32> {
    let charts = if entry.charts.is_empty() {
        dashboards::overview_chart_names()
    } else {
        entry.charts.clone()
    };
    crate::commands::run_tui_session(
        client,
        cfg,
        crate::tui::TuiOptions {
            dashboard: entry.name.clone(),
            charts,
            table: crate::config::DEFAULT_TABLE.to_string(),
            page_size: 15,
            start_overview: true,
            host_id: cfg.host_id,
        },
    )
    .await?;
    Ok(0)
}

fn wants_picker() -> bool {
    io::stdin().is_terminal() && io::stdout().is_terminal()
}

fn print_list(entries: &[DashboardEntry], reason: Option<&str>, json_out: bool) -> Result<i32> {
    if json_out {
        output::print_json(&json!({
            "dashboards": entries.iter().map(|e| json!({
                "name": e.name,
                "source": e.source,
                "charts": e.charts,
            })).collect::<Vec<_>>(),
            "saved_error": reason,
        }))?;
        return Ok(0);
    }
    for e in entries {
        println!("{}", e.name);
    }
    if let Some(reason) = reason {
        eprintln!("{reason}");
    }
    Ok(0)
}

struct PickerGuard;

impl Drop for PickerGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), cursor::Show);
    }
}

/// Inline picker (no alt-screen). Alt-screen is reserved for the live TUI and chat.
fn pick(entries: &[DashboardEntry]) -> Result<Option<usize>> {
    if entries.is_empty() {
        bail!("no dashboards to list");
    }
    enable_raw_mode()?;
    let _guard = PickerGuard;
    let mut stdout = io::stdout();
    execute!(stdout, cursor::Hide)?;
    let mut selected = 0usize;
    let n = entries.len();
    loop {
        for (i, entry) in entries.iter().enumerate() {
            let mark = if i == selected { '>' } else { ' ' };
            write!(stdout, "{mark} {}\r\n", entry.label())?;
        }
        write!(stdout, " j/k select  Enter open  q quit\r\n")?;
        stdout.flush()?;

        let rows = (n + 1) as u16;
        execute!(stdout, cursor::MoveToPreviousLine(rows))?;

        loop {
            if !event::poll(std::time::Duration::from_millis(250))? {
                continue;
            }
            match event::read()? {
                event::Event::Resize(_, _) => break,
                event::Event::Key(key)
                    if matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) =>
                {
                    if key.modifiers.contains(KeyModifiers::CONTROL)
                        && key.code == KeyCode::Char('c')
                    {
                        finish_picker(&mut stdout, rows)?;
                        return Ok(None);
                    }
                    match key.code {
                        KeyCode::Enter => {
                            finish_picker(&mut stdout, rows)?;
                            return Ok(Some(selected));
                        }
                        KeyCode::Esc | KeyCode::Char('q') => {
                            finish_picker(&mut stdout, rows)?;
                            return Ok(None);
                        }
                        KeyCode::Down | KeyCode::Char('j') => {
                            selected = (selected + 1) % n;
                            break;
                        }
                        KeyCode::Up | KeyCode::Char('k') => {
                            selected = selected.checked_sub(1).unwrap_or(n - 1);
                            break;
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
        execute!(stdout, Clear(ClearType::FromCursorDown))?;
    }
}

fn finish_picker(stdout: &mut io::Stdout, rows: u16) -> Result<()> {
    execute!(
        stdout,
        Clear(ClearType::FromCursorDown),
        cursor::MoveToNextLine(rows),
        cursor::Show
    )?;
    let _ = disable_raw_mode();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn print_list_json_includes_overview() {
        let entries = [DashboardEntry::overview()];
        // just exercise label / json shape
        let v = json!({
            "dashboards": entries.iter().map(|e| json!({
                "name": e.name,
                "source": e.source,
                "charts": e.charts,
            })).collect::<Vec<_>>(),
            "saved_error": "HTTP 501",
        });
        assert_eq!(v["dashboards"][0]["name"], "Overview");
        assert_eq!(v["dashboards"][0]["source"], "builtin");
        assert!(v["dashboards"][0]["charts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c == "query-count"));
    }
}
