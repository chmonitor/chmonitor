//! `chm diagnose` wrapper.

use anyhow::{bail, Result};
use reqwest::Client;

use crate::{diagnose, update};

pub async fn run(
    client: &Client,
    ch_host: Option<String>,
    ch_user: String,
    ch_password: String,
    ch_database: String,
    json: bool,
) -> Result<i32> {
    let Some(raw_host) = ch_host else {
        bail!(
            "no host given — pass --ch-host or set the matching dashboard host env \
             (e.g. http://localhost:8123 chm diagnose)"
        );
    };
    // Multi-host clusters use a comma-separated host list (same env var
    // the dashboard reads); this zero-signup CLI diagnoses one host at a time.
    let first_host = raw_host
        .split(',')
        .next()
        .map(str::trim)
        .filter(|h| !h.is_empty())
        .unwrap_or(&raw_host);
    if raw_host.contains(',') {
        eprintln!(
            "note: host list has multiple hosts — diagnosing only the first ({first_host}). Use the dashboard for multi-host clusters."
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
    let report = diagnose::run_diagnostics(client, &ch_cfg).await?;
    if json {
        println!("{}", diagnose::render_json(&report)?);
    } else {
        print!("{}", diagnose::render_text(&report));
    }
    // Gentle, best-effort "update available" hint (opt out with
    // CHM_NO_UPDATE_CHECK=1). Never fails the command.
    update::hint(client).await;
    if report
        .findings
        .iter()
        .any(|f| f.severity == diagnose::Severity::Critical)
    {
        Ok(1)
    } else {
        Ok(0)
    }
}
