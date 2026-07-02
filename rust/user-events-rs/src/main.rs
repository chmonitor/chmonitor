use std::collections::BTreeSet;
use std::io::{self, Read};

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Deserialize)]
struct Row {
    event_time: Option<Value>,
    user: Option<Value>,
    count: Option<Value>,
}

#[derive(Debug, Serialize)]
struct Output {
    data: IndexMap<String, IndexMap<String, f64>>,
    users: Vec<String>,
    chart_data: Vec<Map<String, Value>>,
}

fn stringify(v: Option<Value>) -> String {
    match v {
        Some(Value::String(s)) => s,
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

fn to_count(v: Option<Value>) -> f64 {
    match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn transform(rows: Vec<Row>, time_field: &str) -> Output {
    let mut user_set = BTreeSet::new();
    let mut nested: IndexMap<String, IndexMap<String, f64>> = IndexMap::new();

    for row in rows {
        let event_time = stringify(row.event_time);
        let raw_user = stringify(row.user);
        let user = if raw_user.trim().is_empty() {
            "(empty)".to_string()
        } else {
            raw_user
        };
        let count = to_count(row.count);

        user_set.insert(user.clone());
        let counts = nested.entry(event_time).or_default();
        *counts.entry(user).or_insert(0.0) += count;
    }

    let users: Vec<String> = user_set.into_iter().collect();

    let mut chart_data = Vec::with_capacity(nested.len());
    for (time, counts) in &nested {
        let mut entry = Map::new();
        entry.insert(time_field.to_string(), Value::String(time.clone()));
        for (u, c) in counts {
            entry.insert(u.clone(), Value::from(*c));
        }
        chart_data.push(entry);
    }

    Output {
        data: nested,
        users,
        chart_data,
    }
}

fn main() {
    if let Err(err) = run() {
        eprintln!("{err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let mut payload: Value =
        serde_json::from_str(&input).map_err(|e| format!("invalid json payload: {e}"))?;

    let data_val = payload.get_mut("data").map(|v| v.take());
    let rows: Vec<Row> = serde_json::from_value(data_val.unwrap_or(Value::Array(vec![])))
        .map_err(|e| format!("data must be array: {e}"))?;
    let time_field = payload
        .get("timeField")
        .and_then(|v| v.as_str())
        .unwrap_or("event_time");

    let out = transform(rows, time_field);
    println!("{}", serde_json::to_string(&out)?);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accumulates_duplicate_user_buckets() {
        let rows = vec![
            Row {
                event_time: Some(Value::String("2026-01-01 00:00:00".to_string())),
                user: Some(Value::String("alice".to_string())),
                count: Some(Value::from(2)),
            },
            Row {
                event_time: Some(Value::String("2026-01-01 00:00:00".to_string())),
                user: Some(Value::String("alice".to_string())),
                count: Some(Value::from(3)),
            },
        ];

        let out = transform(rows, "event_time");

        assert_eq!(
            out.data
                .get("2026-01-01 00:00:00")
                .and_then(|counts| counts.get("alice")),
            Some(&5.0)
        );
        assert_eq!(out.chart_data[0].get("alice"), Some(&Value::from(5.0)));
    }
}
