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

# Normalize a pin (chm-v0.2.0 / v0.2.0 / 0.2.0 / chm-0.2.0) to chm-vX.Y.Z.
normalize_chm_tag() {
  rest="$1"
  rest="${rest#chm-v}"
  rest="${rest#chm-}"
  rest="${rest#v}"
  printf 'chm-v%s\n' "$rest"
}

# True when $1 (x.y.z) is strictly greater than $2.
semver_gt() {
  IFS=. read -r a1 a2 a3 _ <<EOF
${1}
EOF
  IFS=. read -r b1 b2 b3 _ <<EOF
${2}
EOF
  a1="${a1:-0}"; a2="${a2:-0}"; a3="${a3:-0}"
  b1="${b1:-0}"; b2="${b2:-0}"; b3="${b3:-0}"
  case "$a1$a2$a3$b1$b2$b3" in
    *[!0-9]*) return 1 ;;
  esac
  if [ "$a1" -gt "$b1" ]; then return 0; fi
  if [ "$a1" -lt "$b1" ]; then return 1; fi
  if [ "$a2" -gt "$b2" ]; then return 0; fi
  if [ "$a2" -lt "$b2" ]; then return 1; fi
  [ "$a3" -gt "$b3" ]
}

# Newest published chm-v* tag from GitHub releases JSON (skip drafts/prereleases).
# Ranks by semver, not list order — dashboard/Helm releases share this API.
pick_newest_chm_tag() {
  json="$1"
  best_tag=""
  best_ver="0.0.0"
  cur_tag=""
  cur_draft=""
  cur_pre=""

  consider_tag() {
    tag="$1"
    draft="$2"
    pre="$3"
    case "$tag" in
      chm-v*) ;;
      *) return 0 ;;
    esac
    if [ "$draft" = "true" ] || [ "$pre" = "true" ]; then
      return 0
    fi
    ver="${tag#chm-v}"
    case "$ver" in
      *-*) return 0 ;;
    esac
    if [ -z "$best_tag" ] || semver_gt "$ver" "$best_ver"; then
      best_tag="$tag"
      best_ver="$ver"
    fi
    return 0
  }

  # Stream tag_name / draft / prerelease in document order (compact JSON, no jq).
  # `|| true`: grep exits 1 on no match, and pipefail would abort the installer.
  fields="$(printf '%s' "$json" | grep -oE '"(tag_name|draft|prerelease)": *("[^"]*"|true|false)' | sed -E 's/"tag_name": *"([^"]*)"/tag_name \1/; s/"draft": *(true|false)/draft \1/; s/"prerelease": *(true|false)/prerelease \1/' || true)"
  while read -r key val; do
    [ -n "$key" ] || continue
    case "$key" in
      tag_name)
        if [ -n "$cur_tag" ]; then
          consider_tag "$cur_tag" "$cur_draft" "$cur_pre"
        fi
        cur_tag="$val"
        cur_draft=""
        cur_pre=""
        ;;
      draft) cur_draft="$val" ;;
      prerelease) cur_pre="$val" ;;
    esac
  done <<EOF
${fields}
EOF
  if [ -n "$cur_tag" ]; then
    consider_tag "$cur_tag" "$cur_draft" "$cur_pre"
  fi
  if [ -n "$best_tag" ]; then
    printf '%s\n' "$best_tag"
  fi
}

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

if [ "${CHM_INSTALL_SELF_TEST:-}" = "1" ]; then
  [ "$(normalize_chm_tag '0.2.0')" = "chm-v0.2.0" ]
  [ "$(normalize_chm_tag 'chm-0.2.0')" = "chm-v0.2.0" ]
  [ "$(normalize_chm_tag 'v0.2.0')" = "chm-v0.2.0" ]
  [ "$(normalize_chm_tag 'chm-v0.2.0')" = "chm-v0.2.0" ]
  json='[{"tag_name":"chm-v0.1.0","prerelease":false,"draft":true},{"tag_name":"v0.3.3","prerelease":false,"draft":false},{"tag_name":"chm-v0.1.0","prerelease":false,"draft":false},{"tag_name":"chm-v0.1.1","prerelease":false,"draft":false},{"tag_name":"chm-v0.2.0","prerelease":true,"draft":false}]'
  got="$(pick_newest_chm_tag "$json")"
  if [ "$got" != "chm-v0.1.1" ]; then
    die "pick_newest_chm_tag: expected chm-v0.1.1, got '$got'"
  fi
  empty="$(pick_newest_chm_tag '[]')"
  [ -z "$empty" ]
  log "install.sh self-test ok"
  exit 0
fi

TARGET="$(detect_target)"
ASSET_NAME="${BIN_NAME}-${TARGET}"

# --- resolve the release tag ----------------------------------------------
resolve_version() {
  if [ -n "${CHM_VERSION:-}" ]; then
    normalize_chm_tag "$CHM_VERSION"
    return
  fi

  log "Looking up latest published chm-v* release..."
  releases_json="$(curl -fsSL -H "User-Agent: chmonitor-installer" \
    "https://api.github.com/repos/${REPO}/releases?per_page=100" 2>/dev/null)" \
    || die "failed to query GitHub releases API for ${REPO}. Fallback: cargo install ch-monitor-cli --force"

  tag="$(pick_newest_chm_tag "$releases_json")"

  if [ -z "$tag" ]; then
    die "no published chm-v* release found for ${REPO} yet. Pin one with CHM_VERSION=chm-vX.Y.Z, or: cargo install ch-monitor-cli --force"
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
  die "failed to download ${BIN_URL} — the release may not include a binary for ${TARGET}, or the tag doesn't exist. Set CHM_VERSION=chm-vX.Y.Z to pin a different release, or: cargo install ch-monitor-cli --force"
fi

if [ ! -s "$BIN_PATH" ]; then
  die "downloaded file is empty: ${BIN_URL}"
fi

# --- verify checksum (mandatory; never install an unverified binary) ---
if ! curl -fsSL -o "$SHA_PATH" "$SHA_URL"; then
  die "no checksum asset at ${SHA_URL} — refusing to install unverified binary. Fallback: cargo install ch-monitor-cli --force"
fi

expected="$(awk '{print $1}' "$SHA_PATH")"
if [ -z "$expected" ]; then
  die "checksum file was empty — refusing to install unverified binary. Fallback: cargo install ch-monitor-cli --force"
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$BIN_PATH" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$BIN_PATH" | awk '{print $1}')"
else
  die "neither sha256sum nor shasum found — cannot verify checksum, refusing to install unverified binary. Fallback: cargo install ch-monitor-cli --force"
fi

if [ "$expected" != "$actual" ]; then
  die "checksum mismatch for ${ASSET_NAME}: expected ${expected}, got ${actual}. Download may be corrupt or tampered with — aborting. Fallback: cargo install ch-monitor-cli --force"
fi
log "Checksum verified."

chmod +x "$BIN_PATH"

mkdir -p "$INSTALL_DIR" 2>/dev/null || die "could not create install directory '$INSTALL_DIR'"
if [ ! -w "$INSTALL_DIR" ]; then
  die "install directory '$INSTALL_DIR' is not writable. This script never invokes sudo. Re-run with CHM_INSTALL_DIR pointing at a writable directory, or: cargo install ch-monitor-cli --force"
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
log ""
log "Update later with:"
log "  ${BIN_NAME} upgrade"
log "  ${BIN_NAME} update     # same command"

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
