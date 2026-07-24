#!/usr/bin/env bash
# chmonitor CLI (`chm`) installer.
#
# Downloads the right prebuilt `chm` binary for your OS/arch from GitHub
# Releases (tag format `chm-v*`), verifies its sha256 checksum, and installs
# it to a user-writable directory. No account, no Rust toolchain required.
#
# Usage:
#   curl -sSf https://chmonitor.dev/install.sh | bash
# (chmonitor.dev/install.sh redirects to this file on the main branch)
#
# Env overrides:
#   CHM_VERSION       Install a specific release tag (e.g. "chm-v0.1.0").
#                      Defaults to the latest "chm-v*" release.
#   CHM_INSTALL_DIR    Directory to install the binary into.
#                      Defaults to "$HOME/.local/bin".
#
# This script never invokes sudo. If CHM_INSTALL_DIR is not writable, it
# fails with instructions instead of silently escalating privileges.

set -euo pipefail

REPO="chmonitor/chmonitor"
BIN_NAME="chm"
INSTALL_DIR="${CHM_INSTALL_DIR:-$HOME/.local/bin}"

log() { printf '%s\n' "$*" >&2; }
die() {
  log "error: $*"
  exit 1
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "required command '$1' not found on PATH"
  fi
}

need_cmd curl
need_cmd uname
need_cmd mktemp

# --- detect OS/arch, map to the release workflow's target triples ---------
detect_target() {
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux) os_part="unknown-linux-gnu" ;;
    Darwin) os_part="apple-darwin" ;;
    *) die "unsupported OS '$os' — chmonitor CLI only ships Linux and macOS binaries today. Build from source: cargo build --release --manifest-path rust/ch-monitor-cli/Cargo.toml" ;;
  esac

  case "$arch" in
    x86_64 | amd64) arch_part="x86_64" ;;
    aarch64 | arm64) arch_part="aarch64" ;;
    *) die "unsupported architecture '$arch' — chmonitor CLI only ships x86_64 and aarch64 binaries today." ;;
  esac

  printf '%s-%s\n' "$arch_part" "$os_part"
}

TARGET="$(detect_target)"
ASSET_NAME="${BIN_NAME}-${TARGET}"

# --- resolve the release tag ----------------------------------------------
resolve_version() {
  if [ -n "${CHM_VERSION:-}" ]; then
    printf '%s\n' "$CHM_VERSION"
    return
  fi

  log "Looking up latest chm-v* release..."
  releases_json="$(curl -fsSL -H "User-Agent: chmonitor-installer" \
    "https://api.github.com/repos/${REPO}/releases" 2>/dev/null)" \
    || die "failed to query GitHub releases API for ${REPO}"

  # The API returns compact single-line JSON, so extract just the matching
  # fragment with `grep -o` — a line-based sed would greedily capture the LAST
  # tag_name on the line instead of the first chm-v* one.
  tag="$(printf '%s' "$releases_json" \
    | grep -o '"tag_name": *"chm-v[^"]*"' \
    | head -n 1 \
    | sed -E 's/.*"(chm-v[^"]*)".*/\1/')"

  if [ -z "$tag" ]; then
    die "no chm-v* release found for ${REPO} yet. The CLI has not been cut a release yet — ask the maintainer to push a 'chm-v*' tag, or build from source: cargo build --release --manifest-path rust/ch-monitor-cli/Cargo.toml. You can also pin an explicit tag with CHM_VERSION=chm-vX.Y.Z."
  fi

  printf '%s\n' "$tag"
}

VERSION="$(resolve_version)"
BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
BIN_URL="${BASE_URL}/${ASSET_NAME}"
SHA_URL="${BASE_URL}/${ASSET_NAME}.sha256"

log "Installing chmonitor CLI ${VERSION} (${TARGET})..."

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

BIN_PATH="${TMP_DIR}/${ASSET_NAME}"
SHA_PATH="${TMP_DIR}/${ASSET_NAME}.sha256"

if ! curl -fsSL -o "$BIN_PATH" "$BIN_URL"; then
  die "failed to download ${BIN_URL} — the release may not include a binary for ${TARGET}, or the tag doesn't exist. Set CHM_VERSION to try a different release, or build from source."
fi

if [ ! -s "$BIN_PATH" ]; then
  die "downloaded file is empty: ${BIN_URL}"
fi

# --- verify checksum (best-effort but fatal if the asset exists and mismatches) ---
if curl -fsSL -o "$SHA_PATH" "$SHA_URL" 2>/dev/null; then
  expected="$(awk '{print $1}' "$SHA_PATH")"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$BIN_PATH" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$BIN_PATH" | awk '{print $1}')"
  else
    die "neither sha256sum nor shasum found — cannot verify checksum, refusing to install unverified binary"
  fi

  if [ "$expected" != "$actual" ]; then
    die "checksum mismatch for ${ASSET_NAME}: expected ${expected}, got ${actual}. Download may be corrupt or tampered with — aborting."
  fi
  log "Checksum verified."
else
  log "warning: no .sha256 checksum asset found for ${VERSION}/${ASSET_NAME} — installing without verification."
fi

chmod +x "$BIN_PATH"

mkdir -p "$INSTALL_DIR" 2>/dev/null || die "could not create install directory '$INSTALL_DIR'"
if [ ! -w "$INSTALL_DIR" ]; then
  die "install directory '$INSTALL_DIR' is not writable. Re-run with CHM_INSTALL_DIR pointing at a writable directory, or move the binary yourself (sudo may be required): sudo cp '$BIN_PATH' '$INSTALL_DIR/$BIN_NAME'"
fi

mv "$BIN_PATH" "${INSTALL_DIR}/${BIN_NAME}"

log ""
log "chmonitor CLI installed to ${INSTALL_DIR}/${BIN_NAME}"

case ":$PATH:" in
  *":${INSTALL_DIR}:"*) : ;;
  *)
    log ""
    log "'${INSTALL_DIR}' is not on your PATH. Add it, e.g.:"
    log "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac

log ""
log "Run a zero-signup health check against a ClickHouse host:"
log "  CLICKHOUSE_HOST=http://localhost:8123 CLICKHOUSE_USER=default ${INSTALL_DIR}/${BIN_NAME} diagnose"

# --- anonymous, opt-out install ping (best-effort, backgrounded) -----------
# Records a single anonymous cli_install event (os/arch + version) to the same
# collector the CLI and dashboard use. It is a hard no-op when telemetry is
# opted out, running under CI, or the endpoint is emptied. Sends NO hostnames,
# IPs, paths, or identity — only an ephemeral random id + os/arch + version.
send_install_ping() {
  # Opt-out: DO_NOT_TRACK (hard override), CHM_TELEMETRY=off/0/false/no, CI.
  case "${DO_NOT_TRACK:-}" in
    '' | 0 | false | False | FALSE) : ;;
    *) return 0 ;;
  esac
  case "$(printf '%s' "${CHM_TELEMETRY:-}" | tr '[:upper:]' '[:lower:]')" in
    off | 0 | false | no) return 0 ;;
  esac
  case "${CI:-}" in
    '' | 0 | false | False | FALSE) : ;;
    *) return 0 ;;
  esac

  # CHM_TELEMETRY_ENDPOINT explicitly set to empty = hard kill-switch.
  if [ "${CHM_TELEMETRY_ENDPOINT+set}" = set ] && [ -z "${CHM_TELEMETRY_ENDPOINT}" ]; then
    return 0
  fi
  endpoint="https://telemetry.chmonitor.dev/v1/cli"

  # os/arch in the collector's enum vocabulary.
  case "$(uname -s)" in
    Linux) tel_os="linux" ;;
    Darwin) tel_os="macos" ;;
    *) tel_os="unknown" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) tel_arch="x86_64" ;;
    aarch64 | arm64) tel_arch="aarch64" ;;
    *) tel_arch="unknown" ;;
  esac

  # Ephemeral 64-hex id — one-shot installs do not persist identity.
  if command -v hexdump >/dev/null 2>&1; then
    tel_id="$(head -c 32 /dev/urandom 2>/dev/null | hexdump -v -e '/1 "%02x"' 2>/dev/null)"
  else
    tel_id="$(head -c 32 /dev/urandom 2>/dev/null | od -An -tx1 2>/dev/null | tr -d ' \n')"
  fi
  [ "${#tel_id}" -eq 64 ] || return 0

  # Version → semver-ish (collector drops anything that isn't MAJOR.MINOR[.PATCH]).
  tel_ver="$(printf '%s' "$VERSION" | sed -E 's/^chm-v//')"

  payload="$(printf '{"install_id":"%s","event":"cli_install","command":"install","cli_version":"%s","os":"%s","arch":"%s"}' \
    "$tel_id" "$tel_ver" "$tel_os" "$tel_arch")"

  # Fire-and-forget: short timeout, silent, never blocks or fails the install.
  curl -fsS -m 2 -X POST -H "content-type: application/json" \
    --data "$payload" "$endpoint" >/dev/null 2>&1 || true
}

# Backgrounded; the curl inside is self-bounded to 2s (-m 2), so this never
# holds the installer open for long and never affects its exit status.
send_install_ping &
