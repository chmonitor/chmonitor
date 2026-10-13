//! Anonymous, opt-out CLI telemetry — a SEPARATE id space from the dashboard's
//! product telemetry. Best-effort and non-blocking: it never fails
//! a command and never delays process exit by more than ~300ms.
//!
//! ## What is sent (and nothing else)
//! A single JSON POST (one event) to the shared telemetry service, project
//! `chmonitor`:
//! ```json
//! {
//!   "event":   "cli_run" | "cli_diagnose",
//!   "id":      "<64-hex opaque random id>",  // persisted, not tied to identity
//!   "version": "0.1.0",
//!   "os":      "linux" | "macos" | "windows" | "unknown",
//!   "arch":    "x86_64" | "aarch64" | "unknown",
//!   "props":   { "command": "doctor" | "hosts" | "chart" | ... }
//! }
//! ```
//! No ClickHouse host, query text, args, paths, IPs, usernames, or license key
//! are ever included (a license key is an identifier and must not reach public
//! telemetry). The id is 32 random bytes hex-encoded, generated once and stored
//! at `$XDG_CONFIG_HOME/chmonitor/cli-id` (default `~/.config/...`); the
//! service hashes it again, and it exists only to count distinct installs — it
//! maps to no identity.
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

const DEFAULT_ENDPOINT: &str = "https://telemetry.anyr.workers.dev/chmonitor";
/// Hard cap on how long we let a ping delay process exit.
const EXIT_BUDGET: Duration = Duration::from_millis(300);
/// The network request's own timeout (sub-second, best-effort).
const REQUEST_TIMEOUT: Duration = Duration::from_millis(800);

#[derive(Serialize)]
struct CliProps {
    command: &'static str,
}

#[derive(Serialize)]
struct CliPing {
    event: &'static str,
    id: String,
    version: &'static str,
    os: &'static str,
    arch: &'static str,
    props: CliProps,
}

fn build_ping(id: String, event: &'static str, command: &'static str) -> CliPing {
    CliPing {
        event,
        id,
        version: env!("CARGO_PKG_VERSION"),
        os: os(),
        arch: arch(),
        props: CliProps { command },
    }
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
        let ping = build_ping(install_id(), event, command);
        let Ok(client) = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            // Do not keep idle connections: they spawn pool tasks that outlive
            // the request and can stall process exit.
            .pool_max_idle_per_host(0)
            .build()
        else {
            return;
        };
        // Errors are intentionally ignored — telemetry must never surface.
        let _ = client.post(&endpoint).json(&ping).send().await;
    }))
}

/// Await the spawned ping, but never block exit longer than `EXIT_BUDGET`.
///
/// Dropping a [`JoinHandle`] *detaches* the task (it keeps running). A
/// timed-out ping must be [`abort`](JoinHandle::abort)ed so reqwest's
/// connection-pool workers cannot keep the Tokio runtime alive after the
/// command has already printed its result.
pub async fn finish(handle: Option<JoinHandle<()>>) {
    let Some(mut handle) = handle else {
        return;
    };
    tokio::select! {
        _ = &mut handle => {}
        () = tokio::time::sleep(EXIT_BUDGET) => {
            handle.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{build_ping, finish, EXIT_BUDGET};
    use serde_json::{json, Value};
    use std::time::{Duration, Instant};

    #[tokio::test]
    async fn finish_aborts_slow_task_instead_of_waiting() {
        let handle = tokio::spawn(async {
            tokio::time::sleep(Duration::from_secs(30)).await;
        });
        let started = Instant::now();
        finish(Some(handle)).await;
        let elapsed = started.elapsed();
        assert!(
            elapsed < EXIT_BUDGET + Duration::from_millis(400),
            "finish waited {elapsed:?} (budget {EXIT_BUDGET:?})"
        );
    }

    fn ping_json(id: &str, event: &'static str, command: &'static str) -> Value {
        serde_json::to_value(build_ping(id.to_string(), event, command)).expect("serialize")
    }

    #[test]
    fn ping_carries_the_install_id_as_id() {
        // The persisted install id is the user identity the service counts; a
        // different id here would silently reset DAU/WAU/MAU continuity.
        let id = "a".repeat(64);
        let v = ping_json(&id, "cli_run", "hosts");
        assert_eq!(v["id"], json!(id));
        assert_eq!(v["event"], json!("cli_run"));
    }

    #[test]
    fn command_travels_in_props_and_version_is_the_cli_version() {
        let v = ping_json(&"b".repeat(64), "cli_diagnose", "doctor");
        assert_eq!(v["props"], json!({ "command": "doctor" }));
        assert_eq!(v["version"], json!(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn ping_has_exactly_the_fields_the_service_accepts() {
        let v = ping_json(&"c".repeat(64), "cli_run", "ls");
        let mut keys: Vec<&str> = v
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, ["arch", "event", "id", "os", "props", "version"]);
    }

    #[test]
    fn license_key_is_never_sent_even_when_set_in_the_environment() {
        // A license key is an identifier; it must not reach public telemetry.
        let key = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        std::env::set_var("CHM_LICENSE_KEY", key);
        let body = ping_json(&"d".repeat(64), "cli_run", "hosts").to_string();
        std::env::remove_var("CHM_LICENSE_KEY");
        assert!(!body.contains("license"), "body: {body}");
        assert!(!body.contains(key), "body: {body}");
    }
}
