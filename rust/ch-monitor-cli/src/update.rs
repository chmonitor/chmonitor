//! Self-update: `chm update`.
//!
//! Downloads the newest (or a pinned) `chm-v*` release from GitHub, verifies its
//! sha256 checksum, and atomically replaces the running executable. No sudo — if
//! the install directory is not writable we print the manual command instead.

use std::{env, fs, path::Path, time::Duration};

use anyhow::{anyhow, bail, Context, Result};
use reqwest::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};

const RELEASES_API: &str = "https://api.github.com/repos/chmonitor/chmonitor/releases";
const RELEASE_DOWNLOAD: &str = "https://github.com/chmonitor/chmonitor/releases/download";
const USER_AGENT: &str = concat!("chm-cli/", env!("CARGO_PKG_VERSION"));

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
struct Release {
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
    releases
        .iter()
        .filter(|r| !r.draft && !r.prerelease && r.tag_name.starts_with("chm-v"))
        .filter_map(|r| parse_version(&r.tag_name).map(|v| (v, r.tag_name.clone())))
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, tag)| tag)
}

/// Fetch the newest published `chm-v*` release tag.
async fn latest_tag(client: &Client) -> Result<String> {
    let releases: Vec<Release> = client
        .get(RELEASES_API)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("failed to reach GitHub releases API")?
        .error_for_status()
        .context("GitHub releases API returned an error status")?
        .json()
        .await
        .context("failed to parse GitHub releases JSON")?;
    newest_chm_tag(&releases)
        .ok_or_else(|| anyhow!("no chm-v* release found — has the CLI been released yet?"))
}

fn current_version() -> Version {
    parse_version(env!("CARGO_PKG_VERSION")).unwrap_or(Version(0, 0, 0))
}

fn ensure_supported_target() -> Result<()> {
    if !SUPPORTED_TARGETS.contains(&TARGET) {
        bail!(
            "unsupported platform for self-update ('{TARGET}'). \
             Install from source instead: cargo install ch-monitor-cli"
        );
    }
    Ok(())
}

/// `chm update --check`: report whether a newer release exists.
/// Returns `true` when an update is available.
pub async fn check(client: &Client) -> Result<bool> {
    let current = current_version();
    let latest_tag = latest_tag(client).await?;
    let latest = parse_version(&latest_tag)
        .ok_or_else(|| anyhow!("could not parse latest release tag '{latest_tag}'"))?;
    if latest > current {
        println!(
            "update available: {} -> {latest_tag} (run `chm update`)",
            env!("CARGO_PKG_VERSION")
        );
        Ok(true)
    } else {
        println!("chm is up to date (v{})", env!("CARGO_PKG_VERSION"));
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
        let releases: Vec<Release> = client
            .get(RELEASES_API)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .ok()?
            .json()
            .await
            .ok()?;
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
            "note: a newer chm is available ({} -> {tag}). Run `chm update`. (set CHM_NO_UPDATE_CHECK=1 to silence)",
            env!("CARGO_PKG_VERSION")
        );
    }
}

/// `chm update` (and `chm update --version <tag>`): download, verify, replace.
pub async fn run(client: &Client, pinned: Option<String>) -> Result<()> {
    ensure_supported_target()?;
    let current = current_version();

    let target_tag = match pinned {
        Some(tag) => {
            if tag.starts_with("chm-v") {
                tag
            } else {
                format!("chm-v{}", tag.trim_start_matches('v'))
            }
        }
        None => latest_tag(client).await?,
    };
    let target_version = parse_version(&target_tag)
        .ok_or_else(|| anyhow!("could not parse target tag '{target_tag}'"))?;

    if pinned_is_none_and_current(&target_version, &current) {
        println!("chm is already up to date (v{})", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    let asset = format!("chm-{TARGET}");
    let bin_url = format!("{RELEASE_DOWNLOAD}/{target_tag}/{asset}");
    let sha_url = format!("{bin_url}.sha256");

    println!("Downloading {asset} ({target_tag})...");
    let bin_bytes = client
        .get(&bin_url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .with_context(|| format!("failed to download {bin_url}"))?
        .error_for_status()
        .with_context(|| {
            format!("no release asset at {bin_url} — is {TARGET} published for {target_tag}?")
        })?
        .bytes()
        .await
        .context("failed to read downloaded binary")?;

    // Checksum verification is mandatory: abort on a missing or mismatched sum.
    let sha_text = client
        .get(&sha_url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .with_context(|| {
            format!("no checksum asset at {sha_url} — refusing to install unverified binary")
        })?
        .text()
        .await
        .context("failed to read checksum file")?;
    let expected = sha_text
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_lowercase();
    if expected.is_empty() {
        bail!("checksum file was empty — refusing to install unverified binary");
    }
    let actual = hex_sha256(&bin_bytes);
    if actual != expected {
        bail!("checksum mismatch for {asset}: expected {expected}, got {actual}. Download may be corrupt or tampered with — aborting.");
    }

    let exe = env::current_exe().context("could not locate the running executable")?;
    let dir = exe
        .parent()
        .ok_or_else(|| anyhow!("executable has no parent directory"))?;

    install_binary(dir, &exe, &bin_bytes).map_err(|e| manual_hint(&exe, &e))?;

    println!(
        "Updated chm {} -> {target_tag} ({})",
        env!("CARGO_PKG_VERSION"),
        exe.display()
    );
    Ok(())
}

fn pinned_is_none_and_current(target: &Version, current: &Version) -> bool {
    target == current
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
fn manual_hint(exe: &Path, err: &anyhow::Error) -> anyhow::Error {
    anyhow!(
        "could not install the update automatically ({err}).\n\
         The install directory may not be writable ({}).\n\
         Re-run the installer manually (no sudo needed if you own the dir):\n\
             curl -sSf https://raw.githubusercontent.com/chmonitor/chmonitor/main/scripts/install.sh | bash\n\
         or move a downloaded `chm-{TARGET}` binary over {} yourself.",
        exe.parent().map(|p| p.display().to_string()).unwrap_or_default(),
        exe.display(),
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
}
