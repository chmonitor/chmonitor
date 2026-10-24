#!/usr/bin/env bash
# List merged release PRs still labeled `autorelease: pending`.
#
# release-please aborts EVERY component with "There are untagged, merged
# release PRs outstanding" while one exists (v0.3.9, #4158). When the PR's
# release tag already exists, the label is simply stale: swap it to
# `autorelease: tagged`. When the tag does not exist, the release never
# happened: do NOT relabel, investigate the release-please run instead.
#
# Usage: scripts/check-release-labels.sh [owner/repo]   (exit 1 when any found)
set -euo pipefail

REPO="${1:-chmonitor/chmonitor}"
found=0

while IFS=$'\t' read -r number title; do
  [ -n "$number" ] || continue
  # Title shapes: "release dashboard v0.3.9", "release cli chm-v0.1.5",
  # "release helm-chart 0.2.19" -> tags v0.3.9, chm-v0.1.5, helm-chmonitor-0.2.19.
  ver="${title##* }"
  case "$title" in
    *"release helm-chart "*) tag="helm-chmonitor-${ver}" ;;
    *) tag="$ver" ;;
  esac
  if gh api "repos/${REPO}/git/ref/tags/${tag}" >/dev/null 2>&1; then
    found=1
    echo "#${number} ${title} -> tag ${tag} exists, label is stale"
    echo "  fix: gh pr edit ${number} -R ${REPO} --remove-label 'autorelease: pending' --add-label 'autorelease: tagged'"
  else
    echo "#${number} ${title} -> tag ${tag} missing; release did not happen, investigate (do not relabel)" >&2
    found=1
  fi
done < <(gh pr list -R "$REPO" --state merged --label 'autorelease: pending' \
  --limit 100 --json number,title --jq '.[] | "\(.number)\t\(.title)"')

if [ "$found" -eq 0 ]; then
  echo "OK: no merged PRs labeled 'autorelease: pending'"
fi
exit "$found"
