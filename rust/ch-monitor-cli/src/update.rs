//! Self-update: `chm update` / `chm upgrade`.
//!
//! Downloads the newest (or a pinned) `chm-v*` release from GitHub, verifies its
//! sha256 checksum, and atomically replaces the running executable. Never
//! invokes sudo — checksum, permission, and unsupported-target failures print a
//! copy-pasteable fallback (`scripts/install.sh` or `cargo install`).

use std::{env, fs, path::Path, time::Duration};

use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::cli::Channel;

const RELEASES_API: &str = "https://api.github.com/repos/chmonitor/chmonitor/releases";
const RELEASE_DOWNLOAD: &str = "https://github.com/chmonitor/chmonitor/releases/download";
const USER_AGENT: &str = concat!("chm-cli/", env!("CARGO_PKG_VERSION"));
const INSTALL_SH: &str =
    "curl -sSf https://raw.githubusercontent.com/chmonitor/chmonitor/main/scripts/install.sh | bash";
const CARGO_INSTALL: &str = "cargo install ch-monitor-cli --force";
/// GitHub's default page size is 30; this repo also ships dashboard/Helm releases.
const RELEASES_PER_PAGE: u32 = 100;
/// Safety cap so a huge releases list cannot loop forever.
const RELEASES_MAX_PAGES: u32 = 5;

/// Compile-time target triple, injected by `build.rs`.
const TARGET: &str = env!("CHM_TARGET");

/// The four platform triples we publish release assets for.
const SUPPORTED_TARGETS: &[&str] = &[
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
];

#[derive(Debug, Deserialize)]
pub(crate) struct Release {
    tag_name: String,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    draft: bool,
}

/// A parsed semantic version (major.minor.patch), ignoring any pre-release/build
/// suffix for ordering purposes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Version(u64, u64, u64);

/// Strip the `chm-v` (or bare `v`) prefix and parse `major.minor.patch`.
fn parse_version(tag: &str) -> Option<Version> {
    let s = tag
        .strip_prefix("chm-v")
        .or_else(|| tag.strip_prefix("chm-"))
        .or_else(|| tag.strip_prefix('v'))
        .unwrap_or(tag);
    // Drop any pre-release / build metadata (e.g. `1.2.3-rc1`, `1.2.3+abc`).
    let core = s.split(['-', '+']).next().unwrap_or(s);
    let mut it = core.split('.');
    let major = it.next()?.parse().ok()?;
    let minor = it.next().unwrap_or("0").parse().ok()?;
    let patch = it.next().unwrap_or("0").parse().ok()?;
    Some(Version(major, minor, patch))
}

/// Pick the newest `chm-v*` tag from a releases list (skips drafts/prereleases).
fn newest_chm_tag(releases: &[Release]) -> Option<String> {
    newest_chm_tag_for_channel(releases, Channel::Stable)
}

/// Pick the newest `chm-v*` tag for a release channel.
///
/// - `stable`: published non-prerelease only (drafts skipped).
/// - `beta`: includes prereleases; when semver cores tie, prefers the prerelease.
pub fn newest_chm_tag_for_channel(releases: &[Release], channel: Channel) -> Option<String> {
    let mut best: Option<(Version, bool, String)> = None;
    for r in releases {
        if r.draft || !r.tag_name.starts_with("chm-v") {
            continue;
        }
        match channel {
            Channel::Stable if r.prerelease => continue,
            Channel::Stable | Channel::Beta => {}
        }
        let Some(ver) = parse_version(&r.tag_name) else {
            continue;
        };
        let cand = (ver, r.prerelease, r.tag_name.clone());
        let take = match &best {
            None => true,
            Some(cur) => match cand.0.cmp(&cur.0) {
                std::cmp::Ordering::Greater => true,
                std::cmp::Ordering::Less => false,
                std::cmp::Ordering::Equal => match channel {
                    // Beta prefers prerelease when versions match.
                    Channel::Beta => cand.1 && !cur.1,
                    Channel::Stable => false,
                },
            },
        };
        if take {
            best = Some(cand);
        }
    }
    best.map(|(_, _, tag)| tag)
}

/// Normalize a user-supplied pin (`chm-v0.2.0`, `v0.2.0`, `0.2.0`, `chm-0.2.0`)
/// into the GitHub release tag `chm-vX.Y.Z`.
fn normalize_release_tag(tag: &str) -> String {
    let t = tag.trim();
    let rest = t
        .strip_prefix("chm-v")
        .or_else(|| t.strip_prefix("chm-"))
        .or_else(|| t.strip_prefix('v'))
        .unwrap_or(t)
        .trim_start_matches('v');
    format!("chm-v{rest}")
}

/// Copy-pasteable recovery when self-update cannot finish. Never includes a
/// `sudo ` command — this path does not escalate privileges.
fn fallback_block() -> String {
    format!(
        "This command never invokes sudo. Copy-paste a fallback:\n  {INSTALL_SH}\n\nor:\n  {CARGO_INSTALL}"
    )
}

fn with_fallback(detail: impl std::fmt::Display) -> anyhow::Error {
    anyhow!("{detail}\n{}", fallback_block())
}

fn unsupported_target_error(target: &str) -> anyhow::Error {
    anyhow!(
        "unsupported platform for self-update ('{target}'). \
         Prebuilt binaries ship for Linux and macOS (x86_64, aarch64) only.\n\
         Build from source instead:\n  {CARGO_INSTALL}"
    )
}

fn checksum_failure(detail: &str) -> anyhow::Error {
    with_fallback(detail)
}

/// Fetch published GitHub releases, paging past dashboard/Helm tags.
async fn fetch_releases(client: &Client, max_pages: u32) -> Result<Vec<Release>> {
    let mut all = Vec::new();
    for page in 1..=max_pages.max(1) {
        let url = format!("{RELEASES_API}?per_page={RELEASES_PER_PAGE}&page={page}");
        let batch: Vec<Release> = client
            .get(&url)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| with_fallback(format!("failed to reach GitHub releases API: {e}")))?
            .error_for_status()
            .map_err(|e| {
                with_fallback(format!("GitHub releases API returned an error status: {e}"))
            })?
            .json()
            .await
            .map_err(|e| with_fallback(format!("failed to parse GitHub releases JSON: {e}")))?;
        let n = batch.len();
        all.extend(batch);
        if n < RELEASES_PER_PAGE as usize {
            break;
        }
    }
    Ok(all)
}

/// Fetch the newest published `chm-v*` release tag.
#[allow(dead_code)]
async fn latest_tag(client: &Client) -> Result<String> {
    latest_tag_for_channel(client, Channel::Stable).await
}

/// Fetch the newest `chm-v*` release tag for a channel.
pub async fn latest_tag_for_channel(client: &Client, channel: Channel) -> Result<String> {
    let releases = fetch_releases(client, RELEASES_MAX_PAGES).await?;
    newest_chm_tag_for_channel(&releases, channel).ok_or_else(|| {
        with_fallback(format!(
            "no published chm-v* release found for channel {} — pin one with --version chm-vX.Y.Z, \
             or has the CLI been released yet?",
            channel.as_str()
        ))
    })
}

fn current_version() -> Version {
    parse_version(env!("CARGO_PKG_VERSION")).unwrap_or(Version(0, 0, 0))
}

fn ensure_supported_target() -> Result<()> {
    if !SUPPORTED_TARGETS.contains(&TARGET) {
        return Err(unsupported_target_error(TARGET));
    }
    Ok(())
}

/// `chm update --check` / `chm upgrade --check`: report whether a newer release exists.
/// Returns `true` when an update is available.
#[allow(dead_code)]
pub async fn check(client: &Client) -> Result<bool> {
    check_channel(client, Channel::Stable).await
}

/// Channel-aware update check.
pub async fn check_channel(client: &Client, channel: Channel) -> Result<bool> {
    let current = current_version();
    let latest_tag = latest_tag_for_channel(client, channel).await?;
    let latest = parse_version(&latest_tag)
        .ok_or_else(|| anyhow!("could not parse latest release tag '{latest_tag}'"))?;
    println!(
        "chm v{} ({}) -> {latest_tag}",
        env!("CARGO_PKG_VERSION"),
        channel.as_str()
    );
    if latest > current {
        println!("update available (run `chm update` or `chm upgrade`)");
        Ok(true)
    } else {
        println!("chm is up to date");
        Ok(false)
    }
}

/// Best-effort background hint for `chm diagnose`: prints a one-line notice to
/// stderr if a newer release exists. Never fails the caller; opt out with
/// `CHM_NO_UPDATE_CHECK=1`.
pub async fn hint(client: &Client) {
    if env::var("CHM_NO_UPDATE_CHECK").is_ok_and(|v| !v.is_empty() && v != "0") {
        return;
    }
    let fut = async {
        // One page is enough for a best-effort hint (sub-second timeout).
        let releases = fetch_releases(client, 1).await.ok()?;
        let tag = newest_chm_tag(&releases)?;
        let latest = parse_version(&tag)?;
        if latest > current_version() {
            Some(tag)
        } else {
            None
        }
    };
    if let Ok(Some(tag)) = tokio::time::timeout(Duration::from_millis(900), fut).await {
        eprintln!(
            "note: a newer chm is available (v{} -> {tag}). Run `chm update` or `chm upgrade`. (set CHM_NO_UPDATE_CHECK=1 to silence)",
            env!("CARGO_PKG_VERSION")
        );
    }
}

/// `chm update` / `chm upgrade` (and `--version <tag>`): download, verify, replace.
#[allow(dead_code)]
pub async fn run(client: &Client, pinned: Option<String>) -> Result<()> {
    run_channel(client, pinned, Channel::Stable).await
}

/// True when this binary lives under a Homebrew prefix (Cellar / Caskroom).
/// Self-update refuses to replace brew-managed installs.
pub fn is_brew_managed() -> bool {
    let Ok(exe) = env::current_exe() else {
        return false;
    };
    let path = exe.to_string_lossy().to_ascii_lowercase();
    path.contains("/cellar/")
        || path.contains("/caskroom/")
        || path.contains("/homebrew/")
        || path.contains("\\homebrew\\")
}

/// Channel-aware self-update.
pub async fn run_channel(client: &Client, pinned: Option<String>, channel: Channel) -> Result<()> {
    if is_brew_managed() {
        return Err(anyhow!(
            "this chm binary appears to be managed by Homebrew.\n\
             Refuse to self-update — run `brew upgrade chm` (or reinstall) instead."
        ));
    }
    ensure_supported_target()?;
    let current = current_version();

    let target_tag = match &pinned {
        Some(tag) => normalize_release_tag(tag),
        None => latest_tag_for_channel(client, channel).await?,
    };
    let target_version = parse_version(&target_tag)
        .ok_or_else(|| anyhow!("could not parse target tag '{target_tag}'"))?;

    println!(
        "chm v{} ({}) -> {target_tag}",
        env!("CARGO_PKG_VERSION"),
        channel.as_str()
    );

    if target_version == current {
        let current_tag = format!("chm-v{}", env!("CARGO_PKG_VERSION"));
        // On beta, a same-core prerelease tag may still be a different build.
        let beta_prerelease_bump = matches!(channel, Channel::Beta)
            && pinned.is_none()
            && target_tag != current_tag
            && target_tag.contains('-');
        if !beta_prerelease_bump {
            println!("chm is already up to date");
            return Ok(());
        }
    } else if target_version < current && pinned.is_none() {
        println!("chm is already up to date");
        return Ok(());
    }

    let asset = format!("chm-{TARGET}");
    let bin_url = format!("{RELEASE_DOWNLOAD}/{target_tag}/{asset}");
    let sha_url = format!("{bin_url}.sha256");

    println!("Downloading {asset}...");
    let bin_bytes = client
        .get(&bin_url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| with_fallback(format!("failed to download {bin_url}: {e}")))?
        .error_for_status()
        .map_err(|_| {
            with_fallback(format!(
                "no release asset at {bin_url} — is {TARGET} published for {target_tag}?"
            ))
        })?
        .bytes()
        .await
        .map_err(|e| with_fallback(format!("failed to read downloaded binary: {e}")))?;

    // Checksum verification is mandatory: abort on a missing or mismatched sum.
    let sha_text = match client
        .get(&sha_url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .and_then(|r| r.error_for_status())
    {
        Ok(resp) => resp.text().await.context("failed to read checksum file")?,
        Err(_) => {
            return Err(checksum_failure(&format!(
                "no checksum asset at {sha_url} — refusing to install unverified binary"
            )));
        }
    };
    let expected = sha_text
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_lowercase();
    if expected.is_empty() {
        return Err(checksum_failure(
            "checksum file was empty — refusing to install unverified binary",
        ));
    }
    let actual = hex_sha256(&bin_bytes);
    if actual != expected {
        return Err(checksum_failure(&format!(
            "checksum mismatch for {asset}: expected {expected}, got {actual}. \
             Download may be corrupt or tampered with — aborting."
        )));
    }

    let exe = env::current_exe().context("could not locate the running executable")?;
    let dir = exe
        .parent()
        .ok_or_else(|| anyhow!("executable has no parent directory"))?;

    install_binary(dir, &exe, &bin_bytes).map_err(|e| permission_hint(&exe, &e))?;
    ensure_chmonitor_alias(dir, &exe);

    println!(
        "Updated chm v{} -> {target_tag} ({})",
        env!("CARGO_PKG_VERSION"),
        exe.display()
    );
    Ok(())
}

fn hex_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Keep a `chmonitor` sibling pointing at `chm` after self-update (install.sh
/// does the same). If the user ran update via the full `chmonitor` cargo bin,
/// sync bytes onto `chm` first so the alias never points at a stale primary.
/// Best-effort: never fails the update if the alias cannot be created.
fn ensure_chmonitor_alias(dir: &Path, exe: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;

        let chm = dir.join("chm");
        let name = exe.file_name().and_then(|s| s.to_str()).unwrap_or("");

        if name != "chm" {
            match exe.symlink_metadata() {
                Ok(meta) if meta.file_type().is_symlink() => {}
                Ok(_) => {
                    let same = exe
                        .canonicalize()
                        .ok()
                        .zip(chm.canonicalize().ok())
                        .is_some_and(|(a, b)| a == b);
                    if !same {
                        let _ = fs::copy(exe, &chm);
                        let _ = set_executable(&chm);
                    }
                }
                Err(_) => return,
            }
        }

        if !chm.exists() {
            return;
        }
        let alias = dir.join("chmonitor");
        if alias.symlink_metadata().is_ok() {
            let _ = fs::remove_file(&alias);
        }
        let _ = symlink("chm", &alias);
    }
    #[cfg(not(unix))]
    {
        let _ = (dir, exe);
    }
}

/// Write the new binary to a temp file in the same directory, chmod 0755, then
/// rename over the original. Handles "text file busy" by moving the running
/// binary aside first.
fn install_binary(dir: &Path, exe: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = dir.join(format!(".chm-update-{}", std::process::id()));
    fs::write(&tmp, bytes).with_context(|| format!("cannot write to {}", dir.display()))?;
    set_executable(&tmp)?;

    if let Err(err) = fs::rename(&tmp, exe) {
        // ETXTBSY / EBUSY: rename the running binary aside, then move the new one in.
        let backup = dir.join(format!(".chm-old-{}", std::process::id()));
        if fs::rename(exe, &backup).is_ok() {
            match fs::rename(&tmp, exe) {
                Ok(()) => {
                    let _ = fs::remove_file(&backup);
                }
                Err(e2) => {
                    // Roll back so we never leave the user without a binary.
                    let _ = fs::rename(&backup, exe);
                    let _ = fs::remove_file(&tmp);
                    return Err(e2).context("failed to move updated binary into place");
                }
            }
        } else {
            let _ = fs::remove_file(&tmp);
            return Err(err).context("failed to replace the running executable");
        }
    }
    Ok(())
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))
        .with_context(|| format!("failed to set permissions on {}", path.display()))
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> Result<()> {
    Ok(())
}

/// Turn an install failure into a clear, sudo-free manual instruction.
fn permission_hint(exe: &Path, err: &anyhow::Error) -> anyhow::Error {
    anyhow!(
        "could not install the update automatically ({err}).\n\
         The install directory may not be writable ({}).\n\
         {}",
        exe.parent()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        fallback_block(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_chm_v_prefix() {
        assert_eq!(parse_version("chm-v0.1.0"), Some(Version(0, 1, 0)));
        assert_eq!(parse_version("chm-v1.20.3"), Some(Version(1, 20, 3)));
        assert_eq!(parse_version("v2.0.0"), Some(Version(2, 0, 0)));
        assert_eq!(parse_version("0.3"), Some(Version(0, 3, 0)));
        assert_eq!(parse_version("chm-v1.2.3-rc1"), Some(Version(1, 2, 3)));
    }

    #[test]
    fn parse_version_rejects_junk() {
        assert_eq!(parse_version(""), None);
        assert_eq!(parse_version("chm-v"), None);
        assert_eq!(parse_version("not-a-version"), None);
        assert_eq!(parse_version("chm-vlater"), None);
    }

    #[test]
    fn normalize_release_tag_accepts_common_pins() {
        assert_eq!(normalize_release_tag("chm-v0.2.0"), "chm-v0.2.0");
        assert_eq!(normalize_release_tag("v0.2.0"), "chm-v0.2.0");
        assert_eq!(normalize_release_tag("0.2.0"), "chm-v0.2.0");
        assert_eq!(normalize_release_tag("chm-0.2.0"), "chm-v0.2.0");
        assert_eq!(normalize_release_tag("  chm-v0.1.1  "), "chm-v0.1.1");
    }

    #[test]
    fn newest_tag_picks_semver_not_list_order() {
        // install.sh used to take the first chm-v* grep match (GitHub created_at
        // order, including drafts). Self-update must rank published tags by semver.
        let json = r#"[{"tag_name":"chm-v0.1.0","prerelease":false,"draft":true},{"tag_name":"v0.3.3","prerelease":false,"draft":false},{"tag_name":"chm-v0.1.0","prerelease":false,"draft":false},{"tag_name":"chm-v0.1.1","prerelease":false,"draft":false}]"#;
        let releases: Vec<Release> = serde_json::from_str(json).unwrap();
        assert_eq!(newest_chm_tag(&releases).as_deref(), Some("chm-v0.1.1"));
    }

    #[test]
    fn semver_ordering() {
        assert!(parse_version("chm-v0.2.0") > parse_version("chm-v0.1.9"));
        assert!(parse_version("chm-v1.0.0") > parse_version("chm-v0.99.99"));
        assert!(parse_version("chm-v0.1.10") > parse_version("chm-v0.1.9"));
        assert_eq!(parse_version("chm-v0.1.0"), parse_version("chm-v0.1.0"));
    }

    #[test]
    fn newest_tag_from_release_list() {
        // GitHub returns compact single-line JSON; make sure we parse and rank it.
        let json = r#"[{"tag_name":"chm-v0.1.0","prerelease":false,"draft":false},{"tag_name":"chm-v0.3.0","prerelease":false,"draft":false},{"tag_name":"chm-v0.2.0","prerelease":false,"draft":false},{"tag_name":"other-v9.9.9","prerelease":false,"draft":false}]"#;
        let releases: Vec<Release> = serde_json::from_str(json).unwrap();
        assert_eq!(newest_chm_tag(&releases).as_deref(), Some("chm-v0.3.0"));
    }

    #[test]
    fn newest_tag_skips_drafts_and_prereleases() {
        let json = r#"[{"tag_name":"chm-v0.9.0","prerelease":true,"draft":false},{"tag_name":"chm-v0.8.0","prerelease":false,"draft":true},{"tag_name":"chm-v0.5.0","prerelease":false,"draft":false}]"#;
        let releases: Vec<Release> = serde_json::from_str(json).unwrap();
        assert_eq!(newest_chm_tag(&releases).as_deref(), Some("chm-v0.5.0"));
    }

    #[test]
    fn beta_channel_prefers_prerelease() {
        let json = r#"[{"tag_name":"chm-v0.1.2","prerelease":false,"draft":false},{"tag_name":"chm-v0.1.2-beta.1","prerelease":true,"draft":false},{"tag_name":"chm-v0.1.1","prerelease":false,"draft":false}]"#;
        let releases: Vec<Release> = serde_json::from_str(json).unwrap();
        assert_eq!(
            newest_chm_tag_for_channel(&releases, Channel::Stable).as_deref(),
            Some("chm-v0.1.2")
        );
        assert_eq!(
            newest_chm_tag_for_channel(&releases, Channel::Beta).as_deref(),
            Some("chm-v0.1.2-beta.1")
        );
        // Newer stable still wins on beta when semver core is higher.
        let json2 = r#"[{"tag_name":"chm-v0.2.0","prerelease":false,"draft":false},{"tag_name":"chm-v0.1.9-beta.9","prerelease":true,"draft":false}]"#;
        let releases2: Vec<Release> = serde_json::from_str(json2).unwrap();
        assert_eq!(
            newest_chm_tag_for_channel(&releases2, Channel::Beta).as_deref(),
            Some("chm-v0.2.0")
        );
    }

    #[test]
    fn newest_tag_empty_or_unrelated_is_none() {
        assert_eq!(newest_chm_tag(&[]), None);
        let json = r#"[{"tag_name":"v9.9.9","prerelease":false,"draft":false}]"#;
        let releases: Vec<Release> = serde_json::from_str(json).unwrap();
        assert_eq!(newest_chm_tag(&releases), None);
    }

    #[test]
    fn checksum_matches_known_vector() {
        // sha256("abc")
        assert_eq!(
            hex_sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn supported_targets_cover_shipped_platforms() {
        assert!(SUPPORTED_TARGETS.contains(&"x86_64-unknown-linux-gnu"));
        assert!(SUPPORTED_TARGETS.contains(&"aarch64-apple-darwin"));
    }

    fn assert_copy_pasteable_fallback(msg: &str) {
        assert!(msg.contains("scripts/install.sh"), "{msg}");
        assert!(msg.contains("cargo install ch-monitor-cli"), "{msg}");
        // Match `sudo ` as a command. The phrase "never invokes sudo" must not trip this.
        assert!(
            !msg.contains("sudo "),
            "fallback must not suggest a sudo command: {msg}"
        );
    }

    #[test]
    fn fallback_is_copy_pasteable_and_sudo_free() {
        assert_copy_pasteable_fallback(&fallback_block());
    }

    #[test]
    fn checksum_failure_includes_fallback() {
        let msg =
            checksum_failure("checksum mismatch for chm-x: expected aaa, got bbb").to_string();
        assert!(msg.contains("checksum mismatch"), "{msg}");
        assert_copy_pasteable_fallback(&msg);
    }

    #[test]
    fn permission_hint_includes_fallback() {
        let err = permission_hint(
            Path::new("/usr/local/bin/chm"),
            &anyhow!("permission denied"),
        );
        let msg = err.to_string();
        assert!(msg.contains("/usr/local/bin"), "{msg}");
        assert_copy_pasteable_fallback(&msg);
    }

    #[test]
    fn download_failure_includes_fallback() {
        let msg = with_fallback("no release asset at https://example/chm-x").to_string();
        assert!(msg.contains("no release asset"), "{msg}");
        assert_copy_pasteable_fallback(&msg);
    }

    #[test]
    fn unsupported_target_points_at_cargo() {
        let msg = unsupported_target_error("wasm32-unknown-unknown").to_string();
        assert!(msg.contains("wasm32-unknown-unknown"), "{msg}");
        assert!(msg.contains("cargo install ch-monitor-cli"), "{msg}");
        assert!(
            !msg.contains("install.sh"),
            "unsupported-target fallback must not point at install.sh: {msg}"
        );
        assert!(
            !msg.contains("sudo "),
            "unsupported-target fallback must not suggest a sudo command: {msg}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn ensure_chmonitor_alias_links_to_chm() {
        let dir = std::env::temp_dir().join(format!("chm-alias-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let chm = dir.join("chm");
        fs::write(&chm, b"fake").unwrap();
        ensure_chmonitor_alias(&dir, &chm);
        let alias = dir.join("chmonitor");
        assert!(alias.symlink_metadata().unwrap().file_type().is_symlink());
        assert_eq!(fs::read_link(&alias).unwrap(), Path::new("chm"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn ensure_chmonitor_alias_syncs_from_full_chmonitor_bin() {
        let dir = std::env::temp_dir().join(format!("chm-alias-sync-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let chm = dir.join("chm");
        let full = dir.join("chmonitor");
        fs::write(&chm, b"old").unwrap();
        fs::write(&full, b"new").unwrap();
        ensure_chmonitor_alias(&dir, &full);
        assert_eq!(fs::read(&chm).unwrap(), b"new");
        assert!(dir
            .join("chmonitor")
            .symlink_metadata()
            .unwrap()
            .file_type()
            .is_symlink());
        let _ = fs::remove_dir_all(&dir);
    }
}
