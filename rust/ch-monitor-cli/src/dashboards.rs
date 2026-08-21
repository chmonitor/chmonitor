//! Built-in Overview dashboard + saved-dashboard list parsing.

use serde_json::Value;

use crate::metrics;

/// Built-in dashboard always listed first.
pub const OVERVIEW_NAME: &str = "Overview";

/// Charts on the web Overview page. 404 / empty results are skipped at fetch time.
/// `disk-size-all` is only shown when `disk-size-single` is missing.
pub const OVERVIEW_CHARTS: &[&str] = &[
    "query-count",
    "running-queries-count",
    "database-count",
    "table-count",
    "disk-size-single",
    "disk-size-all",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DashboardEntry {
    pub name: String,
    pub source: &'static str,
    pub charts: Vec<String>,
}

impl DashboardEntry {
    pub fn overview() -> Self {
        Self {
            name: OVERVIEW_NAME.to_string(),
            source: "builtin",
            charts: overview_chart_names(),
        }
    }

    pub fn label(&self) -> String {
        let n = self.charts.len();
        match self.source {
            "builtin" => format!("{}  (builtin, {n} charts)", self.name),
            _ => format!("{}  (saved, {n} charts)", self.name),
        }
    }
}

pub fn overview_chart_names() -> Vec<String> {
    OVERVIEW_CHARTS.iter().map(|s| (*s).to_string()).collect()
}

/// Charts to fetch for `chm` / `chm tui` (Overview, plus an extra name if given).
pub fn tui_chart_names(extra: Option<&str>) -> Vec<String> {
    let mut charts = overview_chart_names();
    if let Some(c) = extra.map(str::trim).filter(|c| !c.is_empty()) {
        if !charts.iter().any(|x| x == c) {
            charts.insert(0, c.to_string());
        }
    }
    charts
}

/// `layout.widgets[].chartName` for `type=chart`.
pub fn chart_names_from_layout(layout: &Value) -> Vec<String> {
    let Some(widgets) = layout.get("widgets").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut names = Vec::new();
    for widget in widgets {
        let obj = widget.as_object();
        let kind = obj
            .and_then(|o| o.get("type"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if kind != "chart" {
            continue;
        }
        if let Some(name) = obj
            .and_then(|o| o.get("chartName"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            if !names.iter().any(|n| n == name) {
                names.push(name.to_string());
            }
        }
    }
    names
}

/// Parse `GET /api/dashboards/list` `data` (`{ dashboards: [...] }` or a bare array).
pub fn parse_saved_dashboards(data: &Value) -> Vec<DashboardEntry> {
    let arr = data
        .get("dashboards")
        .and_then(Value::as_array)
        .or_else(|| data.as_array());
    let Some(arr) = arr else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| {
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())?
                .to_string();
            let layout = item.get("layout").unwrap_or(&Value::Null);
            Some(DashboardEntry {
                name,
                source: "saved",
                charts: chart_names_from_layout(layout),
            })
        })
        .collect()
}

pub fn find_dashboard<'a>(entries: &'a [DashboardEntry], name: &str) -> Option<&'a DashboardEntry> {
    let needle = name.trim();
    entries
        .iter()
        .find(|e| e.name == needle)
        .or_else(|| entries.iter().find(|e| e.name.eq_ignore_ascii_case(needle)))
}

/// Best-effort message from a dashboard API error body.
pub fn api_error_message(text: &str) -> Option<String> {
    let v: Value = serde_json::from_str(text).ok()?;
    v.pointer("/error/message")
        .or_else(|| v.pointer("/error/msg"))
        .or_else(|| v.get("message"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

pub fn format_list_reason(status: u16, body: &str) -> String {
    let detail = api_error_message(body)
        .or_else(|| crate::client::truncate_body(body.trim(), 120))
        .unwrap_or_default();
    if detail.is_empty() {
        format!("saved dashboards unavailable (HTTP {status})")
    } else {
        format!("saved dashboards unavailable (HTTP {status}): {detail}")
    }
}

/// KPI / sparkline caption for a chart's rows.
pub fn chart_kpi(name: &str, rows: &[Value]) -> String {
    if rows.is_empty() {
        return "no data".to_string();
    }
    if name.starts_with("disk-size") {
        return disk_kpi(&rows[0]);
    }
    if let Some(obj) = rows.last().and_then(Value::as_object) {
        for key in ["count", "query_count", "value", "total"] {
            if let Some(v) = obj.get(key) {
                return json_cell(v);
            }
        }
    }
    metrics::row_metric(rows.last().unwrap()).to_string()
}

fn disk_kpi(row: &Value) -> String {
    let used = row
        .get("readable_used_space")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let total = row
        .get("readable_total_space")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match (used, total) {
        (Some(u), Some(t)) => format!("{u} / {t}"),
        (Some(u), None) => u.to_string(),
        _ => {
            let u = row.get("used_space").map(json_cell);
            let t = row.get("total_space").map(json_cell);
            match (u, t) {
                (Some(u), Some(t)) => format!("{u} / {t}"),
                (Some(u), None) => u,
                _ => metrics::row_metric(row).to_string(),
            }
        }
    }
}

fn json_cell(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        other => other.to_string(),
    }
}

/// Prefer `disk-size-single`; hide `disk-size-all` when single returned rows.
pub fn should_show_chart(name: &str, has_data: bool, single_has_data: bool) -> bool {
    if !has_data {
        return false;
    }
    if name == "disk-size-all" && single_has_data {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn overview_is_first_and_has_web_charts() {
        let d = DashboardEntry::overview();
        assert_eq!(d.name, "Overview");
        assert_eq!(d.source, "builtin");
        assert!(d.charts.contains(&"query-count".into()));
        assert!(!d.charts.contains(&"query-count-today".into()));
        assert!(d.charts.contains(&"database-count".into()));
        assert!(d.charts.contains(&"table-count".into()));
        assert!(d.charts.contains(&"disk-size-single".into()));
    }

    #[test]
    fn extra_tui_chart_is_prepended_once() {
        let names = tui_chart_names(Some("query-count"));
        assert_eq!(names.iter().filter(|n| *n == "query-count").count(), 1);
        let names = tui_chart_names(Some("custom-chart"));
        assert_eq!(names[0], "custom-chart");
        assert!(names.contains(&"query-count".into()));
    }

    #[test]
    fn layout_widgets_collect_chart_names() {
        let layout = json!({
            "widgets": [
                {"type": "chart", "chartName": "query-count"},
                {"type": "table", "queryConfigName": "running-queries"},
                {"type": "chart", "chartName": "merges"},
                {"type": "chart", "chartName": "query-count"},
                {"type": "stat", "chartName": "ignored"}
            ]
        });
        assert_eq!(
            chart_names_from_layout(&layout),
            vec!["query-count", "merges"]
        );
    }

    #[test]
    fn parse_saved_dashboards_reads_name_and_widgets() {
        let data = json!({
            "dashboards": [
                {
                    "name": "Nightly",
                    "layout": {
                        "widgets": [
                            {"type": "chart", "chartName": "cpu"}
                        ]
                    }
                }
            ]
        });
        let list = parse_saved_dashboards(&data);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Nightly");
        assert_eq!(list[0].source, "saved");
        assert_eq!(list[0].charts, vec!["cpu"]);
    }

    #[test]
    fn find_dashboard_is_case_insensitive() {
        let list = vec![DashboardEntry::overview()];
        assert!(find_dashboard(&list, "overview").is_some());
        assert!(find_dashboard(&list, " missing ").is_none());
    }

    #[test]
    fn kpi_prefers_count_and_disk_readable() {
        assert_eq!(
            chart_kpi("running-queries-count", &[json!({"count": 12})]),
            "12"
        );
        assert_eq!(
            chart_kpi(
                "disk-size-single",
                &[json!({
                    "readable_used_space": "42.0 GiB",
                    "readable_total_space": "100 GiB"
                })]
            ),
            "42.0 GiB / 100 GiB"
        );
        assert_eq!(chart_kpi("query-count", &[]), "no data");
    }

    #[test]
    fn hide_disk_all_when_single_has_data() {
        assert!(should_show_chart("disk-size-single", true, true));
        assert!(!should_show_chart("disk-size-all", true, true));
        assert!(should_show_chart("disk-size-all", true, false));
        assert!(!should_show_chart("query-count", false, false));
    }

    #[test]
    fn api_error_message_reads_nested_error() {
        assert_eq!(
            api_error_message(r#"{"error":{"message":"Dashboard storage is not enabled."}}"#)
                .as_deref(),
            Some("Dashboard storage is not enabled.")
        );
        assert_eq!(
            format_list_reason(501, r#"{"error":{"message":"off"}}"#),
            "saved dashboards unavailable (HTTP 501): off"
        );
    }
}
