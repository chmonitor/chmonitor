use wasm_bindgen::prelude::*;

/// WASM export to transform a ClickHouse JSON-each-row string into a normalized JSON array.
#[wasm_bindgen]
pub fn transform_clickhouse_json_each_row_json(input: &str) -> Result<String, JsValue> {
    Ok(ch_json::transform_clickhouse_json_each_row(input))
}

/// Standalone Rust-callable library function for backward compatibility.
pub fn transform_clickhouse_json_each_row(input: &str) -> String {
    ch_json::transform_clickhouse_json_each_row(input)
}

/// WASM export returning JsValue directly — avoids JSON string intermediate.
///
/// BENCHMARK-ONLY / NOT USED BY THE APP (see issue #2150). The user-event pivot
/// runs in pure TypeScript (`apps/dashboard/src/lib/chart-data-transforms/transforms/user-events.ts`,
/// `transformUserEventCounts`) per `docs/knowledge/rust-wasm-performance.md`
/// ("keep object transforms in TS"). This export is retained only for the WASM
/// benchmarks in `scripts/benchmarks/`. Fully removing it requires rebuilding the
/// committed `.wasm` binary, which is out of scope for issue #2150 — leave to a
/// maintainer who can run the wasm build.
#[wasm_bindgen(js_name = transform_user_event_counts_v2)]
pub fn transform_user_event_counts_v2(input: &str, time_field: &str) -> Result<JsValue, JsValue> {
    let result = ch_pivot::transform_user_event_counts(input, time_field)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// WASM export accepting JsValue input and returning JsValue output — zero JSON string overhead.
/// JS side: pass pre-parsed array directly, get result object directly.
///
/// BENCHMARK-ONLY / NOT USED BY THE APP (see issue #2150). The dead TS wrapper
/// (`transformUserEventCountsWasm`) that used to call this was removed; the
/// object-pivot runs in pure TypeScript (`transformUserEventCounts`) per
/// `docs/knowledge/rust-wasm-performance.md`. This export is retained only for the
/// WASM benchmarks in `scripts/benchmarks/`. Fully removing it requires rebuilding
/// the committed `.wasm` binary, which is out of scope for issue #2150 — leave to a
/// maintainer who can run the wasm build.
#[wasm_bindgen(js_name = transform_user_event_counts_v3)]
pub fn transform_user_event_counts_v3(
    input: JsValue,
    time_field: &str,
) -> Result<JsValue, JsValue> {
    let rows: Vec<ch_pivot::UserEventRow> =
        serde_wasm_bindgen::from_value(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result = ch_pivot::transform_user_event_rows(rows, time_field);
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Legacy export returning JSON string (kept for backward compat).
#[wasm_bindgen]
pub fn transform_user_event_counts_json(input: &str, time_field: &str) -> String {
    ch_pivot::transform_user_event_counts(input, time_field)
        .and_then(|result| serde_json::to_string(&result))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn normalizes_json_each_row_text() {
        let input = r#"
          {"123":"key stays string","small":"123","large":"9007199254740992","nested":{"value":"-3"}}
          {"small":"456","leading_zero":"001","list":["1","2.5","text"]}
        "#;

        let output: Value =
            serde_json::from_str(&transform_clickhouse_json_each_row(input)).expect("valid json");

        assert_eq!(output[0]["small"], json!(123));
        assert_eq!(output[0]["123"], json!("key stays string"));
        assert_eq!(output[0]["large"], json!("9007199254740992"));
        assert_eq!(output[0]["nested"]["value"], json!(-3));
        assert_eq!(output[1]["list"], json!([1, 2.5, "text"]));
        assert_eq!(output[1]["leading_zero"], json!("001"));
    }

    #[test]
    fn preserves_escaped_and_unsafe_numeric_strings() {
        let input = r#"{"escaped":"1\n2","float_max":"9007199254740993.0","exp":"1e2"}"#;
        let output: Value =
            serde_json::from_str(&transform_clickhouse_json_each_row(input)).expect("valid json");

        assert_eq!(output[0]["escaped"], json!("1\n2"));
        assert_eq!(output[0]["float_max"], json!("9007199254740993.0"));
        assert_eq!(output[0]["exp"], json!(100));
    }

    #[test]
    fn transforms_user_event_counts() {
        let input = serde_json::json!([
            {"event_time": "2026-01-01 00:00:00", "user": "alice", "count": 5},
            {"event_time": "2026-01-01 00:00:00", "user": "alice", "count": 2},
            {"event_time": "2026-01-01 00:00:00", "user": "", "count": 3},
            {"event_time": "2026-01-01 01:00:00", "user": "alice", "count": 7},
            {"event_time": "2026-01-01 01:00:00", "user": "bob", "count": "2"},
        ])
        .to_string();

        let output_str = transform_user_event_counts_json(&input, "event_time");
        let output: Value = serde_json::from_str(&output_str).expect("valid json");

        assert_eq!(output["users"], json!(["(empty)", "alice", "bob"]));
        assert_eq!(output["data"]["2026-01-01 00:00:00"]["alice"], json!(7.0));
        assert_eq!(output["data"]["2026-01-01 00:00:00"]["(empty)"], json!(3.0));
        assert_eq!(
            output["chartData"][0]["event_time"],
            json!("2026-01-01 00:00:00")
        );
    }
}
