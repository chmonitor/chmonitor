//! `chm dashboard list` / `chm dashboard open`.

use std::io::{self, IsTerminal};

use anyhow::{bail, Result};
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
    match crate::tui::picker::run(
        "dashboard list",
        entries.iter().map(|e| e.label()).collect(),
        " j/k select  Enter open  q quit",
        reason,
    )? {
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
