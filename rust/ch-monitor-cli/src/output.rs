//! Terminal / JSON output helpers.

use std::{
    collections::HashMap,
    env,
    io::{self, IsTerminal, Write},
};

use comfy_table::{presets::UTF8_FULL, Table};
use owo_colors::OwoColorize;
use serde_json::Value;

pub fn wants_color() -> bool {
    if env::var_os("NO_COLOR").is_some() {
        return false;
    }
    if env::var_os("FORCE_COLOR").is_some() {
        return true;
    }
    io::stdout().is_terminal()
}

/// True when an alt-screen TUI is allowed.
///
/// Agents, CI, pipes, `chm --json`, `chm --no-tui`, `CHM_NO_TUI=1`, `CI=1`,
/// and `TERM=dumb` all force a one-shot snapshot instead of ratatui.
pub fn wants_tui(force_json: bool, no_tui_flag: bool) -> bool {
    if force_json || no_tui_flag {
        return false;
    }
    if env_flag("CHM_NO_TUI") || env_flag("CI") || env_flag("GITHUB_ACTIONS") {
        return false;
    }
    if env::var("TERM").ok().as_deref() == Some("dumb") {
        return false;
    }
    io::stdin().is_terminal() && io::stdout().is_terminal()
}

fn env_flag(name: &str) -> bool {
    match env::var(name) {
        Ok(v) => {
            let v = v.trim();
            !v.is_empty()
                && v != "0"
                && !v.eq_ignore_ascii_case("false")
                && !v.eq_ignore_ascii_case("no")
        }
        Err(_) => false,
    }
}

pub fn print_json(value: &Value) -> anyhow::Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

pub fn print_records(data: &[HashMap<String, Value>], limit: usize) {
    if data.is_empty() {
        return;
    }
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

/// Compact braille sparkline for a slice of values.
pub fn braille_sparkline(values: &[u64], width: usize) -> String {
    if values.is_empty() || width == 0 {
        return String::new();
    }
    // Braille block for 0..=8 levels (space + 8 fills).
    const BLOCKS: &[char] = &[' ', '▂', '▃', '▄', '▅', '▆', '▇', '█', '⣿'];
    let max = values.iter().copied().max().unwrap_or(0).max(1);
    let step = (values.len() as f64 / width as f64).max(1.0);
    let mut out = String::with_capacity(width);
    for i in 0..width {
        let start = (i as f64 * step) as usize;
        let end = (((i + 1) as f64 * step) as usize)
            .min(values.len())
            .max(start + 1);
        let window = &values[start..end.min(values.len())];
        let avg = if window.is_empty() {
            0
        } else {
            window.iter().sum::<u64>() / window.len() as u64
        };
        let level = ((avg as f64 / max as f64) * 8.0).round() as usize;
        out.push(BLOCKS[level.min(8)]);
    }
    out
}

/// One-line min / max / avg summary for sparkline values.
pub fn sparkline_stats(values: &[u64]) -> Option<String> {
    if values.is_empty() {
        return None;
    }
    let min = values.iter().copied().min()?;
    let max = values.iter().copied().max()?;
    let sum: u128 = values.iter().map(|&v| u128::from(v)).sum();
    let avg = sum / values.len() as u128;
    Some(format!("min={min}  max={max}  avg={avg}"))
}

pub fn success(msg: &str) {
    if wants_color() {
        eprintln!("{} {msg}", "✔".green());
    } else {
        eprintln!("ok: {msg}");
    }
}

pub fn warn(msg: &str) {
    if wants_color() {
        let _ = writeln!(io::stderr(), "{} {msg}", "!".yellow());
    } else {
        eprintln!("warn: {msg}");
    }
}

pub fn info(msg: &str) {
    if wants_color() {
        eprintln!("{} {msg}", "→".cyan());
    } else {
        eprintln!("info: {msg}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sparkline_stats_empty_is_none() {
        assert!(sparkline_stats(&[]).is_none());
    }

    #[test]
    fn sparkline_stats_reports_min_max_avg() {
        let s = sparkline_stats(&[1, 2, 3, 4]).unwrap();
        assert!(s.contains("min=1"), "{s}");
        assert!(s.contains("max=4"), "{s}");
        assert!(s.contains("avg=2"), "{s}");
    }

    #[test]
    fn braille_sparkline_nonempty() {
        let line = braille_sparkline(&[0, 5, 10, 5, 0], 5);
        assert_eq!(line.chars().count(), 5);
    }

    #[test]
    fn json_or_no_tui_flag_skips_alt_screen() {
        assert!(!wants_tui(true, false));
        assert!(!wants_tui(false, true));
    }
}
