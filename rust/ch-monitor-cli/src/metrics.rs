//! Row metric extraction for sparklines / TUI.

use serde_json::Value;

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

pub fn row_metric(row: &Value) -> u64 {
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
