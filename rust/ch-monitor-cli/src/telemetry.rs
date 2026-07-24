//! Anonymous, opt-out CLI telemetry — a SEPARATE stream from the dashboard's
//! product telemetry (source=cli). Best-effort and non-blocking: it never fails
//! a command and never delays process exit by more than ~300ms.
//!
//! ## What is sent (and nothing else)
//! A single JSON POST to the collector's `/v1/cli` endpoint:
//! ```json
//! {
//!   "install_id":  "<64-hex opaque random id>",  // persisted, not tied to identity
//!   "event":       "cli_run" | "cli_diagnose",
//!   "command":     "diagnose" | "hosts" | "chart" | ...,
//!   "cli_version": "0.1.0",
//!   "os":          "linux" | "macos" | "windows" | "unknown",
//!   "arch":        "x86_64" | "aarch64" | "unknown"
//! }
//! ```
//! No ClickHouse host, query text, args, paths, IPs, or usernames are ever
//! included. The install_id is 32 random bytes hex-encoded, generated once and
//! stored at `$XDG_CONFIG_HOME/chmonitor/cli-id` (default `~/.config/...`); it
//! exists only to count distinct installs — it maps to no identity.
//!
//! ## Opt out (any one disables it entirely)
//!   CHM_TELEMETRY=off            (also 0 / false / no)
//!   DO_NOT_TRACK=1               (cross-tool standard, hard override)
//!   CHM_TELEMETRY_ENDPOINT=""    (empty endpoint = no network call at all)

use std::{
    fs,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::Client;
use serde::Serialize;
use tokio::task::JoinHandle;

const DEFAULT_ENDPOINT: &str = "https://telemetry.chmonitor.dev/v1/cli";
/// Hard cap on how long we let a ping delay process exit.
const EXIT_BUDGET: Duration = Duration::from_millis(300);
/// The network request's own timeout (sub-second, best-effort).
const REQUEST_TIMEOUT: Duration = Duration::from_millis(800);

#[derive(Serialize)]
struct CliPing {
    install_id: String,
    event: &'static str,
    command: &'static str,
    cli_version: &'static str,
    os: &'static str,
    arch: &'static str,
}

/// True when the user has opted out via any supported mechanism.
fn opted_out() -> bool {
    // DO_NOT_TRACK is a hard override (any non-empty, non-"0" value).
    if let Ok(v) = std::env::var("DO_NOT_TRACK") {
        let v = v.trim();
        if !v.is_empty() && v != "0" && !v.eq_ignore_ascii_case("false") {
            return true;
        }
    }
    if let Ok(v) = std::env::var("CHM_TELEMETRY") {
        let v = v.trim().to_ascii_lowercase();
        if matches!(v.as_str(), "off" | "0" | "false" | "no") {
            return true;
        }
    }
    false
}

/// Resolve the collector endpoint. Returns `None` when telemetry is disabled or
/// the endpoint was explicitly emptied (hard kill-switch).
fn endpoint() -> Option<String> {
    match std::env::var("CHM_TELEMETRY_ENDPOINT") {
        // Explicitly set to empty = hard kill-switch.
        Ok(v) if v.trim().is_empty() => None,
        Ok(v) => Some(v.trim().to_string()),
        Err(_) => Some(DEFAULT_ENDPOINT.to_string()),
    }
}

fn os() -> &'static str {
    match std::env::consts::OS {
        "linux" => "linux",
        "macos" => "macos",
        "windows" => "windows",
        _ => "unknown",
    }
}

fn arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        _ => "unknown",
    }
}

/// `$XDG_CONFIG_HOME/chmonitor/cli-id`, falling back to `~/.config/...`.
fn install_id_path() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .or_else(|| dirs::home_dir().map(|h| h.join(".config")))?;
    Some(base.join("chmonitor").join("cli-id"))
}

/// 32 random bytes, hex-encoded (64 lowercase hex chars) — matches the
/// collector's HEX64 validation.
fn random_hex64() -> String {
    // Prefer the OS CSPRNG; this is the common path on the Linux/macOS binaries
    // we ship. No extra crates (keeps Cargo.toml untouched).
    if let Ok(bytes) = fs::read("/dev/urandom") {
        if bytes.len() >= 32 {
            return hex(&bytes[..32]);
        }
    }
    // Fallback: mix time + pid through a small splitmix64 to fill 32 bytes.
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
        ^ ((std::process::id() as u64) << 32);
    let mut state = seed;
    let mut out = Vec::with_capacity(32);
    while out.len() < 32 {
        state = state.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^= z >> 31;
        out.extend_from_slice(&z.to_le_bytes());
    }
    hex(&out[..32])
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Load the persisted install id, creating and storing one on first run.
/// Best-effort: if the config dir is unwritable we still return an id (so the
/// ping can go out) but simply don't persist it.
fn install_id() -> String {
    let Some(path) = install_id_path() else {
        return random_hex64();
    };
    if let Ok(existing) = fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if trimmed.len() == 64 && trimmed.bytes().all(|b| b.is_ascii_hexdigit()) {
            return trimmed.to_ascii_lowercase();
        }
    }
    let id = random_hex64();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, &id);
    id
}

/// Spawn a background ping for the given event/command. Returns `None` when
/// telemetry is disabled (opt-out or empty endpoint) so callers pay nothing.
pub fn spawn(event: &'static str, command: &'static str) -> Option<JoinHandle<()>> {
    if opted_out() {
        return None;
    }
    let endpoint = endpoint()?;
    Some(tokio::spawn(async move {
        let ping = CliPing {
            install_id: install_id(),
            event,
            command,
            cli_version: env!("CARGO_PKG_VERSION"),
            os: os(),
            arch: arch(),
        };
        let Ok(client) = Client::builder().timeout(REQUEST_TIMEOUT).build() else {
            return;
        };
        // Errors are intentionally ignored — telemetry must never surface.
        let _ = client.post(&endpoint).json(&ping).send().await;
    }))
}

/// Await the spawned ping, but never block exit longer than `EXIT_BUDGET`.
pub async fn finish(handle: Option<JoinHandle<()>>) {
    if let Some(handle) = handle {
        let _ = tokio::time::timeout(EXIT_BUDGET, handle).await;
    }
}
