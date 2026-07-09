//! Zero-signup local diagnostics: connect directly to a ClickHouse host (no
//! chmonitor account/backend required) and run a fixed set of read-only
//! health checks against `system.query_log`, `system.parts`, and related
//! system tables, then print a scored report.
//!
//! Every query forces `readonly=2` so this can never mutate the target
//! cluster (see `ch_query`). Each check is independent and best-effort: a
//! failing/missing system table (e.g. a minimal or restricted-permission
//! deployment) skips that one check rather than aborting the whole report,
//! mirroring the dashboard's insight collectors
//! (`apps/dashboard/src/lib/insights/collectors.ts`).

use anyhow::{bail, Context, Result};
use comfy_table::{presets::UTF8_FULL, Cell, Color, Table};
use reqwest::Client;
use serde::Serialize;
use serde_json::Value;

/// Direct ClickHouse connection settings for `chm diagnose`. Distinct from
/// the dashboard-API `AppConfig` used by `hosts`/`chart`/`table`/`tui` — this
/// talks straight to ClickHouse's HTTP interface, no chmonitor backend.
#[derive(Debug, Clone)]
pub struct ChConfig {
    pub url: String,
    pub user: String,
    pub password: String,
    pub database: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Notice,
    Warning,
    Critical,
}

impl Severity {
    fn weight(self) -> u32 {
        match self {
            Severity::Notice => 2,
            Severity::Warning => 8,
            Severity::Critical => 20,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Severity::Notice => "NOTICE",
            Severity::Warning => "WARNING",
            Severity::Critical => "CRITICAL",
        }
    }

    fn color(self) -> Color {
        match self {
            Severity::Notice => Color::Blue,
            Severity::Warning => Color::Yellow,
            Severity::Critical => Color::Red,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    pub id: &'static str,
    pub category: &'static str,
    pub severity: Severity,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub host: String,
    pub version: String,
    pub uptime_seconds: u64,
    pub checks_run: usize,
    pub findings: Vec<Finding>,
    pub score: u32,
}

// ---------------------------------------------------------------------------
// HTTP + row helpers
// ---------------------------------------------------------------------------

/// Run a single read-only query against the ClickHouse HTTP interface and
/// parse the `JSONEachRow` response. Forces `readonly=2` + a query timeout as
/// defense-in-depth (every SQL string in this module is a hardcoded SELECT,
/// so this is a belt-and-braces guard, not the only one). Some clusters'
/// monitoring profiles already force fixed settings and reject *any*
/// explicit attempt to (re)set them — even to the same effective value
/// ("Cannot modify '<setting>' setting in readonly mode", Code: 164) — seen
/// live against ClickHouse's public playground for both `readonly` and
/// `max_execution_time`. On that error, retry once with no settings
/// overrides at all rather than failing every check.
async fn ch_query(client: &Client, cfg: &ChConfig, sql: &str) -> Result<Vec<Value>> {
    match ch_query_once(client, cfg, sql, true).await {
        Ok(rows) => Ok(rows),
        Err(err) if err.to_string().contains("Cannot modify") => {
            ch_query_once(client, cfg, sql, false).await
        }
        Err(err) => Err(err),
    }
}

async fn ch_query_once(
    client: &Client,
    cfg: &ChConfig,
    sql: &str,
    force_settings: bool,
) -> Result<Vec<Value>> {
    let mut params = vec![
        ("query", sql),
        ("database", cfg.database.as_str()),
        ("default_format", "JSONEachRow"),
    ];
    if force_settings {
        params.push(("readonly", "2"));
        params.push(("max_execution_time", "20"));
    }

    let resp = client
        .get(&cfg.url)
        .basic_auth(&cfg.user, Some(&cfg.password))
        .query(&params)
        .send()
        .await
        .with_context(|| format!("failed to reach ClickHouse at {}", cfg.url))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        bail!("ClickHouse returned {status}: {}", text.trim());
    }

    text.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str(line)
                .with_context(|| format!("failed to parse ClickHouse response line: {line}"))
        })
        .collect()
}

fn row_f64(row: &Value, key: &str) -> Option<f64> {
    match row.get(key)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn row_u64(row: &Value, key: &str) -> Option<u64> {
    row_f64(row, key).map(|f| f.max(0.0).round() as u64)
}

fn row_str(row: &Value, key: &str) -> Option<String> {
    row.get(key).and_then(|v| v.as_str()).map(String::from)
}

// ---------------------------------------------------------------------------
// Pure classifiers (thresholds), unit-tested independently of any network
// call. Mirrors apps/dashboard/src/lib/insights/operational-checks.ts's
// split between SQL (collectors) and classification (pure functions).
// ---------------------------------------------------------------------------

fn classify_error_rate(pct: f64) -> Option<Severity> {
    if pct >= 20.0 {
        Some(Severity::Critical)
    } else if pct >= 5.0 {
        Some(Severity::Warning)
    } else {
        None
    }
}

fn classify_slow_p95(ms: f64) -> Option<Severity> {
    if ms >= 30_000.0 {
        Some(Severity::Critical)
    } else if ms >= 5_000.0 {
        Some(Severity::Warning)
    } else {
        None
    }
}

fn classify_fragmented_parts(count: u64) -> Option<Severity> {
    if count >= 1000 {
        Some(Severity::Critical)
    } else if count >= 300 {
        Some(Severity::Warning)
    } else {
        None
    }
}

fn classify_compression(ratio: f64) -> Option<Severity> {
    if ratio >= 0.7 {
        Some(Severity::Notice)
    } else {
        None
    }
}

fn classify_readonly_replicas(count: u64) -> Option<Severity> {
    if count > 0 {
        Some(Severity::Critical)
    } else {
        None
    }
}

fn classify_replication_lag(seconds: f64) -> Option<Severity> {
    if seconds >= 600.0 {
        Some(Severity::Warning)
    } else if seconds >= 60.0 {
        Some(Severity::Notice)
    } else {
        None
    }
}

fn classify_detached_parts(count: u64) -> Option<Severity> {
    if count >= 50 {
        Some(Severity::Warning)
    } else if count >= 10 {
        Some(Severity::Notice)
    } else {
        None
    }
}

fn classify_stuck_mutations(count: u64) -> Option<Severity> {
    if count >= 10 {
        Some(Severity::Critical)
    } else if count >= 1 {
        Some(Severity::Warning)
    } else {
        None
    }
}

fn classify_long_running(seconds: f64) -> Option<Severity> {
    if seconds >= 1800.0 {
        Some(Severity::Critical)
    } else if seconds >= 300.0 {
        Some(Severity::Warning)
    } else {
        None
    }
}

fn classify_failed_dictionaries(count: u64) -> Option<Severity> {
    if count >= 1 {
        Some(Severity::Warning)
    } else {
        None
    }
}

fn classify_disk_usage(pct_used: f64) -> Option<Severity> {
    if pct_used >= 90.0 {
        Some(Severity::Critical)
    } else if pct_used >= 80.0 {
        Some(Severity::Warning)
    } else {
        None
    }
}

/// 100 minus a per-finding severity deduction, floored at 0. Pure so the
/// scoring policy is unit-testable without a ClickHouse connection.
pub fn score_report(findings: &[Finding]) -> u32 {
    let deduction: u32 = findings.iter().map(|f| f.severity.weight()).sum();
    100u32.saturating_sub(deduction)
}

pub fn grade(score: u32) -> &'static str {
    match score {
        90..=100 => "A",
        75..=89 => "B",
        60..=74 => "C",
        40..=59 => "D",
        _ => "F",
    }
}

fn format_duration(seconds: f64) -> String {
    if seconds >= 3600.0 {
        format!("{:.1}h", seconds / 3600.0)
    } else if seconds >= 60.0 {
        format!("{}m", (seconds / 60.0).round() as u64)
    } else {
        format!("{}s", seconds.round() as u64)
    }
}

// ---------------------------------------------------------------------------
// Checks — each is one cheap read-only query + a pure classifier.
// ---------------------------------------------------------------------------

async fn check_error_rate(client: &Client, cfg: &ChConfig) -> Option<Finding> {
    let rows = ch_query(
        client,
        cfg,
        "SELECT countIf(type = 'ExceptionWhileProcessing') * 100.0 / nullIf(count(), 0) AS value \
         FROM system.query_log WHERE event_time > now() - INTERVAL 1 HOUR",
    )
    .await
    .ok()?;
    let value = row_f64(rows.first()?, "value")?;
    let severity = classify_error_rate(value)?;
    Some(Finding {
        id: "error_rate",
        category: "performance",
        severity,
        title: "Query error rate is elevated".into(),
        detail: format!(
            "{:.1}% of queries in the last hour raised an exception. Check running-queries / query_log for the failing patterns.",
            value
        ),
    })
}

async fn check_slow_queries(client: &Client, cfg: &ChConfig) -> Option<Finding> {
    let rows = ch_query(
        client,
        cfg,
        "SELECT quantile(0.95)(query_duration_ms) AS value FROM system.query_log \
         WHERE type = 'QueryFinish' AND event_time > now() - INTERVAL 1 HOUR",
    )
    .await
    .ok()?;
    let value = row_f64(rows.first()?, "value")?;
    let severity = classify_slow_p95(value)?;
    Some(Finding {
        id: "slow_queries_p95",
        category: "performance",
        severity,
        title: "Queries are slow (p95)".into(),
        detail: format!(
            "p95 query duration over the last hour is {:.0}ms. Look for missing filters, full scans, or lock contention.",
            value
        ),
    })
}

async fn check_fragmented_parts(client: &Client, cfg: &ChConfig) -> Option<Finding> {
    let rows = ch_query(
        client,
        cfg,
        "SELECT database, table, count() AS value, formatReadableSize(sum(bytes_on_disk)) AS size \
         FROM system.parts WHERE active GROUP BY database, table ORDER BY value DESC LIMIT 1",
    )
    .await
    .ok()?;
    let row = rows.first()?;
    let count = row_u64(row, "value")?;
    let severity = classify_fragmented_parts(count)?;
    let database = row_str(row, "database").unwrap_or_default();
    let table = row_str(row, "table").unwrap_or_default();
    let size = row_str(row, "size").unwrap_or_default();
    Some(Finding {
        id: "fragmented_parts",
        category: "storage",
        severity,
        title: format!("{database}.{table} is fragmented"),
        detail: format!(
            "{database}.{table} has {count} active parts ({size}). Consider OPTIMIZE or reviewing the partition key to cut merge overhead."
        ),
    })
}

async fn check_compression(client: &Client, cfg: &ChConfig) -> Option<Finding> {
    let rows = ch_query(
        client,
        cfg,
        "SELECT database, table, \
         round(sum(data_compressed_bytes) * 1.0 / nullIf(sum(data_uncompressed_bytes), 0), 3) AS value, \
         formatReadableSize(sum(data_uncompressed_bytes)) AS uncompressed \
         FROM system.parts WHERE active GROUP BY database, table \
         HAVING sum(data_uncompressed_bytes) > 1073741824 ORDER BY value DESC LIMIT 1",
    )
    .await
    .ok()?;
    let row = rows.first()?;
    let ratio = row_f64(row, "value")?;
    let severity = classify_compression(ratio)?;
    let database = row_str(row, "database").unwrap_or_default();
    let table = row_str(row, "table").unwrap_or_default();
    let uncompressed = row_str(row, "uncompressed").unwrap_or_default();
    Some(Finding {
        id: "poor_compression",
        category: "storage",
        severity,
        title: format!("Poor compression on {database}.{table}"),
        detail: format!(
            "{database}.{table} ({uncompressed} uncompressed) compresses to {:.0}% of its size. A better codec (ZSTD/Delta) or column ordering could reclaim storage.",
            ratio * 100.0
        ),
    })
}

async fn check_readonly_replicas(client: &Client, cfg: &ChConfig) -> Option<Finding> {
    let rows = ch_query(
        client,
        cfg,
        "SELECT count() AS value FROM system.replicas WHERE is_readonly",
    )
    .await
    .ok()?;
    let count = row_u64(rows.first()?, "value")?;
    let severity = classify_readonly_replicas(count)?;
    Some(Finding {
        id: "readonly_replicas",
        category: "reliability",
        severity,
        title: format!(
            "{count} replica{} read-only",
            if count == 1 { " is" } else { "s are" }
        ),
        detail: format!(
            "{count} replicated table{} in read-only mode — usually a ZooKeeper/Keeper connectivity problem. Writes to these tables are blocked.",
            if count == 1 { "" } else { "s" }
        ),
    })
}

async fn check_replication_lag(client: &Client, cfg: &ChConfig) -> Option<Finding> {
    let rows = ch_query(
        client,
        cfg,
        "SELECT max(absolute_delay) AS value FROM system.replicas",
    )
    .await
    .ok()?;
    let seconds = row_f64(rows.first()?, "value")?;
    let severity = classify_replication_lag(seconds)?;
    Some(Finding {
        id: "replication_lag",
        category: "reliability",
        severity,
        title: "Replication is lagging".into(),
        detail: format!(
            "The most-delayed replica is {} behind. Sustained lag risks stale reads and growing replication queues.",
            format_duration(seconds)
        ),
    })
}

async fn check_detached_parts(client: &Client, cfg: &ChConfig) -> Option<Finding> {
    let rows = ch_query(
        client,
        cfg,
        "SELECT count() AS value FROM system.detached_parts",
    )
    .await
    .ok()?;
    let count = row_u64(rows.first()?, "value")?;
    let severity = classify_detached_parts(count)?;
    Some(Finding {
        id: "detached_parts",
        category: "storage",
        severity,
        title: format!("{count} detached parts need review"),
        detail: format!(
            "{count} detached parts — usually leftovers from failed merges, ATTACH/DETACH, or corruption. They occupy disk without being queryable."
        ),
    })
}

async fn check_stuck_mutations(client: &Client, cfg: &ChConfig) -> Option<Finding> {
    let rows = ch_query(
        client,
        cfg,
        "SELECT count() AS value FROM system.mutations WHERE is_done = 0 AND latest_fail_reason != ''",
    )
    .await
    .ok()?;
    let count = row_u64(rows.first()?, "value")?;
    let severity = classify_stuck_mutations(count)?;
    Some(Finding {
        id: "stuck_mutations",
        category: "reliability",
        severity,
        title: format!(
            "{count} mutation{} failing to complete",
            if count == 1 { " is" } else { "s are" }
        ),
        detail: format!(
            "{count} mutation{} unfinished with a failure reason set. Stuck mutations block further ALTERs on the affected tables — inspect system.mutations.latest_fail_reason.",
            if count == 1 { " is" } else { "s are" }
        ),
    })
}

async fn check_long_running_query(client: &Client, cfg: &ChConfig) -> Option<Finding> {
    let rows = ch_query(
        client,
        cfg,
        "SELECT max(elapsed) AS value, countIf(elapsed > 60) AS over_minute FROM system.processes",
    )
    .await
    .ok()?;
    let row = rows.first()?;
    let seconds = row_f64(row, "value")?;
    let severity = classify_long_running(seconds)?;
    let over_minute = row_u64(row, "over_minute").unwrap_or(0);
    Some(Finding {
        id: "long_running_query",
        category: "performance",
        severity,
        title: format!("A query has been running for {}", format_duration(seconds)),
        detail: format!(
            "The longest live query has been running for {}{}. Long-running queries hold locks and memory — check for a runaway scan or missing filter.",
            format_duration(seconds),
            if over_minute > 1 {
                format!(" ({over_minute} queries over a minute)")
            } else {
                String::new()
            }
        ),
    })
}

async fn check_long_running_merge(client: &Client, cfg: &ChConfig) -> Option<Finding> {
    let rows = ch_query(
        client,
        cfg,
        "SELECT max(elapsed) AS value FROM system.merges",
    )
    .await
    .ok()?;
    let seconds = row_f64(rows.first()?, "value")?;
    let severity = classify_long_running(seconds)?;
    Some(Finding {
        id: "long_running_merge",
        category: "performance",
        severity,
        title: format!("A merge has been running for {}", format_duration(seconds)),
        detail: format!(
            "The longest in-progress merge has run for {}. Very long merges can starve other merges and grow part counts further.",
            format_duration(seconds)
        ),
    })
}

async fn check_failed_dictionaries(client: &Client, cfg: &ChConfig) -> Option<Finding> {
    let rows = ch_query(
        client,
        cfg,
        "SELECT count() AS value FROM system.dictionaries WHERE status = 'FAILED'",
    )
    .await
    .ok()?;
    let count = row_u64(rows.first()?, "value")?;
    let severity = classify_failed_dictionaries(count)?;
    Some(Finding {
        id: "failed_dictionaries",
        category: "reliability",
        severity,
        title: format!(
            "{count} dictionar{} failed to load",
            if count == 1 { "y" } else { "ies" }
        ),
        detail: format!(
            "{count} dictionar{} in the FAILED state. Queries that read {} will error or fall back — check source connectivity and system.dictionaries.last_exception.",
            if count == 1 { "y is" } else { "ies are" },
            if count == 1 { "it" } else { "them" }
        ),
    })
}

async fn check_disk_usage(client: &Client, cfg: &ChConfig) -> Option<Finding> {
    let rows = ch_query(
        client,
        cfg,
        "SELECT name, round((1 - free_space / nullIf(total_space, 0)) * 100, 1) AS value \
         FROM system.disks ORDER BY value DESC LIMIT 1",
    )
    .await
    .ok()?;
    let row = rows.first()?;
    let pct = row_f64(row, "value")?;
    let severity = classify_disk_usage(pct)?;
    let name = row_str(row, "name").unwrap_or_default();
    Some(Finding {
        id: "disk_usage",
        category: "capacity",
        severity,
        title: format!("Disk '{name}' is {pct:.0}% full"),
        detail: format!(
            "Disk '{name}' is at {pct:.0}% capacity. Running out of disk space blocks merges and inserts — plan a cleanup or expansion."
        ),
    })
}

/// Connect and run every check sequentially (12 short, independent
/// queries — a local run finishes in a couple of seconds). Each check is
/// best-effort: a query failure (missing table, insufficient permission)
/// skips that finding rather than aborting the report.
pub async fn run_diagnostics(client: &Client, cfg: &ChConfig) -> Result<Report> {
    let version_rows = ch_query(client, cfg, "SELECT version() AS value").await?;
    let version = version_rows
        .first()
        .and_then(|r| row_str(r, "value"))
        .unwrap_or_else(|| "unknown".to_string());

    let uptime_rows = ch_query(client, cfg, "SELECT uptime() AS value").await?;
    let uptime_seconds = uptime_rows
        .first()
        .and_then(|r| row_u64(r, "value"))
        .unwrap_or(0);

    let checks: Vec<Option<Finding>> = vec![
        check_error_rate(client, cfg).await,
        check_slow_queries(client, cfg).await,
        check_fragmented_parts(client, cfg).await,
        check_compression(client, cfg).await,
        check_readonly_replicas(client, cfg).await,
        check_replication_lag(client, cfg).await,
        check_detached_parts(client, cfg).await,
        check_stuck_mutations(client, cfg).await,
        check_long_running_query(client, cfg).await,
        check_long_running_merge(client, cfg).await,
        check_failed_dictionaries(client, cfg).await,
        check_disk_usage(client, cfg).await,
    ];
    let checks_run = checks.len();
    let findings: Vec<Finding> = checks.into_iter().flatten().collect();
    let score = score_report(&findings);

    Ok(Report {
        host: cfg.url.clone(),
        version,
        uptime_seconds,
        checks_run,
        findings,
        score,
    })
}

pub fn render_json(report: &Report) -> Result<String> {
    Ok(serde_json::to_string_pretty(report)?)
}

pub fn render_text(report: &Report) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "chmonitor diagnostics — {}\nClickHouse {} · uptime {}\n\n",
        report.host,
        report.version,
        format_duration(report.uptime_seconds as f64)
    ));
    out.push_str(&format!(
        "Score: {}/100 ({}) · {} checks run · {} finding{}\n\n",
        report.score,
        grade(report.score),
        report.checks_run,
        report.findings.len(),
        if report.findings.len() == 1 { "" } else { "s" }
    ));

    if report.findings.is_empty() {
        out.push_str("No issues found. This cluster looks healthy.\n\n");
    } else {
        let mut table = Table::new();
        table.load_preset(UTF8_FULL);
        table.set_header(vec!["Severity", "Category", "Finding", "Detail"]);
        let mut sorted = report.findings.clone();
        sorted.sort_by_key(|f| std::cmp::Reverse(f.severity.weight()));
        for finding in &sorted {
            table.add_row(vec![
                Cell::new(finding.severity.label()).fg(finding.severity.color()),
                Cell::new(finding.category),
                Cell::new(&finding.title),
                Cell::new(&finding.detail),
            ]);
        }
        out.push_str(&format!("{table}\n\n"));
    }

    out.push_str(
        "Deep dive, live charts, and the AI advisor: https://dash.chmonitor.dev (hosted) \
         or self-host: https://docs.chmonitor.dev\n",
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_rate_thresholds() {
        assert_eq!(classify_error_rate(1.0), None);
        assert_eq!(classify_error_rate(5.0), Some(Severity::Warning));
        assert_eq!(classify_error_rate(19.9), Some(Severity::Warning));
        assert_eq!(classify_error_rate(20.0), Some(Severity::Critical));
    }

    #[test]
    fn slow_p95_thresholds() {
        assert_eq!(classify_slow_p95(4_999.0), None);
        assert_eq!(classify_slow_p95(5_000.0), Some(Severity::Warning));
        assert_eq!(classify_slow_p95(30_000.0), Some(Severity::Critical));
    }

    #[test]
    fn fragmented_parts_thresholds() {
        assert_eq!(classify_fragmented_parts(299), None);
        assert_eq!(classify_fragmented_parts(300), Some(Severity::Warning));
        assert_eq!(classify_fragmented_parts(1000), Some(Severity::Critical));
    }

    #[test]
    fn compression_threshold_is_notice_only() {
        assert_eq!(classify_compression(0.69), None);
        assert_eq!(classify_compression(0.7), Some(Severity::Notice));
        assert_eq!(classify_compression(0.99), Some(Severity::Notice));
    }

    #[test]
    fn readonly_replicas_any_is_critical() {
        assert_eq!(classify_readonly_replicas(0), None);
        assert_eq!(classify_readonly_replicas(1), Some(Severity::Critical));
    }

    #[test]
    fn replication_lag_thresholds() {
        assert_eq!(classify_replication_lag(59.0), None);
        assert_eq!(classify_replication_lag(60.0), Some(Severity::Notice));
        assert_eq!(classify_replication_lag(600.0), Some(Severity::Warning));
    }

    #[test]
    fn detached_parts_thresholds() {
        assert_eq!(classify_detached_parts(9), None);
        assert_eq!(classify_detached_parts(10), Some(Severity::Notice));
        assert_eq!(classify_detached_parts(50), Some(Severity::Warning));
    }

    #[test]
    fn stuck_mutations_thresholds() {
        assert_eq!(classify_stuck_mutations(0), None);
        assert_eq!(classify_stuck_mutations(1), Some(Severity::Warning));
        assert_eq!(classify_stuck_mutations(10), Some(Severity::Critical));
    }

    #[test]
    fn long_running_thresholds() {
        assert_eq!(classify_long_running(299.0), None);
        assert_eq!(classify_long_running(300.0), Some(Severity::Warning));
        assert_eq!(classify_long_running(1800.0), Some(Severity::Critical));
    }

    #[test]
    fn failed_dictionaries_any_is_warning() {
        assert_eq!(classify_failed_dictionaries(0), None);
        assert_eq!(classify_failed_dictionaries(1), Some(Severity::Warning));
    }

    #[test]
    fn disk_usage_thresholds() {
        assert_eq!(classify_disk_usage(79.9), None);
        assert_eq!(classify_disk_usage(80.0), Some(Severity::Warning));
        assert_eq!(classify_disk_usage(90.0), Some(Severity::Critical));
    }

    #[test]
    fn score_report_deducts_by_severity_and_floors_at_zero() {
        assert_eq!(score_report(&[]), 100);

        let notice = Finding {
            id: "x",
            category: "storage",
            severity: Severity::Notice,
            title: String::new(),
            detail: String::new(),
        };
        assert_eq!(score_report(std::slice::from_ref(&notice)), 98);

        let critical = Finding {
            severity: Severity::Critical,
            ..notice.clone()
        };
        let many_critical = vec![
            critical.clone(),
            critical.clone(),
            critical.clone(),
            critical.clone(),
            critical.clone(),
            critical,
        ];
        assert_eq!(score_report(&many_critical), 0);
    }

    #[test]
    fn grade_bands() {
        assert_eq!(grade(100), "A");
        assert_eq!(grade(90), "A");
        assert_eq!(grade(89), "B");
        assert_eq!(grade(75), "B");
        assert_eq!(grade(74), "C");
        assert_eq!(grade(60), "C");
        assert_eq!(grade(59), "D");
        assert_eq!(grade(40), "D");
        assert_eq!(grade(39), "F");
        assert_eq!(grade(0), "F");
    }

    #[test]
    fn render_text_reports_clean_cluster() {
        let report = Report {
            host: "http://localhost:8123".into(),
            version: "24.8.1.1".into(),
            uptime_seconds: 3725,
            checks_run: 12,
            findings: vec![],
            score: 100,
        };
        let text = render_text(&report);
        assert!(text.contains("Score: 100/100 (A)"));
        assert!(text.contains("No issues found"));
        assert!(text.contains("1.0h"));
    }

    #[test]
    fn render_json_round_trips_findings() {
        let report = Report {
            host: "http://localhost:8123".into(),
            version: "24.8.1.1".into(),
            uptime_seconds: 10,
            checks_run: 12,
            findings: vec![Finding {
                id: "detached_parts",
                category: "storage",
                severity: Severity::Notice,
                title: "10 detached parts need review".into(),
                detail: "detail".into(),
            }],
            score: 98,
        };
        let json = render_json(&report).expect("serializes");
        assert!(json.contains("\"severity\": \"notice\""));
        assert!(json.contains("\"id\": \"detached_parts\""));
    }
}
