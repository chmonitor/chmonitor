#!/usr/bin/env bash
# create-github-issues.sh — create the 2026-H2 research-driven implementation issues.
#
# WHY THIS IS A SCRIPT (not run for you): the agent sandbox had no `gh` binary and
# no GitHub token, and is not permitted to handle tokens. Run this on your own
# machine where `gh` is already authenticated (`gh auth status`).
#
# Usage:
#   ./create-github-issues.sh            # dry-run: prints what it would create
#   ./create-github-issues.sh --apply    # actually create the issues
#   REPO=chmonitor/chmonitor ./create-github-issues.sh --apply
#
# Idempotency: skips any issue whose exact title already exists (open or closed).
set -euo pipefail

REPO="${REPO:-chmonitor/chmonitor}"
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1
DOC="docs/internal/2026h2-market"

if [[ $APPLY -eq 1 ]]; then
  command -v gh >/dev/null 2>&1 || { echo "ERROR: gh CLI not found. Install: https://cli.github.com/ then 'gh auth login'." >&2; exit 1; }
  gh auth status >/dev/null 2>&1 || { echo "ERROR: run 'gh auth login' first." >&2; exit 1; }
fi

# Ensure labels exist (no-op if they already do). Only when applying.
ensure_label() { [[ $APPLY -eq 1 ]] && gh label create "$1" --repo "$REPO" --color "$2" --force >/dev/null 2>&1 || true; }
ensure_label "market-2026h2" "5319e7"
ensure_label "billing"       "0e8a16"
ensure_label "pricing"       "0e8a16"
ensure_label "revenue"       "0e8a16"
ensure_label "seo"           "1d76db"
ensure_label "content"       "1d76db"
ensure_label "marketing"     "1d76db"
ensure_label "distribution"  "1d76db"
ensure_label "growth"        "fbca04"
ensure_label "analytics"     "fbca04"
ensure_label "mcp"           "d93f0b"
ensure_label "ai"            "d93f0b"
ensure_label "oss"           "c5def5"
ensure_label "cli"           "c5def5"
ensure_label "perf"          "bfdadc"
ensure_label "experiment"    "ededed"

# create_issue <id> <title> <priority> <effort> <labels-csv> <files> <summary>
create_issue() {
  local id="$1" title="$2" prio="$3" eff="$4" labels="$5" files="$6" summary="$7"
  local full_title="[$id] $title"

  # skip if it already exists
  if [[ $APPLY -eq 1 ]] && gh issue list --repo "$REPO" --state all --search "\"$full_title\" in:title" --json title \
        | grep -qF "\"$full_title\""; then
    echo "SKIP (exists): $full_title"; return 0
  fi

  local body
  body=$(cat <<EOF
> Source: 2026-H2 market research. See \`$DOC/05-implementation-tasks.md\` ($id) and
> \`$DOC/01-market-research.md\`. Supplements the numbered roadmap plans (14–70).

**Priority:** $prio · **Effort:** $eff

## What
$summary

## Files (starting points)
$files

## Done criteria
- Implementation matches the summary above and the house invariants (self-host stays
  whole; billing gates fail open without Clerk; honest paywalls; advisor recommends,
  never auto-applies).
- Verification passes: \`bun run type-check\` · \`bun run build\` · targeted
  \`bun test … --isolate\` · \`bun run lint\`.
- For pricing changes: landing pricing cards and in-app billing card stay in sync with
  \`packages/pricing\` (no drift).
EOF
)

  local label_args=(--label "market-2026h2")
  IFS=',' read -ra L <<< "$labels"; for l in "${L[@]}"; do label_args+=(--label "$(echo "$l" | xargs)"); done

  if [[ $APPLY -eq 1 ]]; then
    gh issue create --repo "$REPO" --title "$full_title" --body "$body" "${label_args[@]}" \
      && echo "CREATED: $full_title"
  else
    echo "DRY-RUN would create: $full_title  [labels: market-2026h2,$labels]"
  fi
}

# ── Issues (mirror of github-issues.csv) ────────────────────────────────────────
create_issue "B1" "Explicit included-host counts per tier (Pro=1 Max=3)" "P1" "S" "billing,pricing,revenue" "packages/pricing/src/plans.ts; apps/landing/src/data/pricing.ts" "Add includedHosts per tier so multi-node clusters don't hit surprise overage; surface on landing + in-app billing card. Kills the #1 pricing sticker-shock risk from the research."
create_issue "B2" "Replica = 0.5 billable host" "P2" "M" "billing,pricing" "packages/pricing/src/plans.ts; apps/dashboard/src/lib/billing/entitlements.ts" "Bill a detected replica as 0.5 host (copy pganalyze). Requires replica detection from system.replicas."
create_issue "B3" "BYOK on Free/Pro for the AI advisor" "P1" "M" "billing,ai" "apps/dashboard (AI agent config)" "Allow user-supplied model API key; skip included-credit metering when BYOK is active. Expands funnel + protects margin (confirmed 2026 expectation). Measure BYOK vs included-credit conversion."
create_issue "B4" "\$199 Fleet mid-anchor tier (experiment)" "P2" "M" "billing,pricing,experiment" "packages/pricing/src/plans.ts" "Optional tier for 5-10 host clusters (5 hosts included) to avoid overage surprise. Ship behind an experiment flag; A/B vs Max + overage."
create_issue "B5" "Annual billing (~2 months free) end-to-end" "P2" "S" "billing,revenue" "packages/pricing/src/plans.ts; apps/dashboard billing" "Wire the annual SKU end-to-end after Plan 17 e2e tests pass (yearly = 10x monthly)."
create_issue "S1" "SEO: error-page cluster (4 pages)" "P1" "M" "seo,content,marketing" "apps/blog/src/content/blog; apps/landing/src" "too-many-parts, MEMORY_LIMIT_EXCEEDED, memory-limit-total-exceeded, merges-slower-than-inserts. Real diagnostic SQL + expected output + one-click chmonitor demo. Lowest difficulty, highest intent — build first."
create_issue "S2" "SEO: flagship system.query_log slow-query how-to" "P1" "M" "seo,content,marketing" "apps/blog/src/content/blog" "The SEO page IS the product workflow. Include the exact query_duration_ms>5000 query + a GIF of chmonitor surfacing it."
create_issue "S3" "SEO: optimization hub (6 interlinked pages + pillar)" "P2" "L" "seo,content" "apps/blog/src/content/blog; apps/landing/src" "Partition keys, granularity, PREWHERE vs WHERE, projections vs MVs, skip indices, external GROUP BY. Interlinked hub + pillar page."
create_issue "S4" "SEO: near-ICP comparison pages" "P2" "M" "seo,content" "apps/landing/src" "ClickHouse vs TimescaleDB, vs Postgres (analytics), vs Druid/Pinot only — the rest is ClickHouse.com's turf."
create_issue "S5" "SEO: OG images + meta audit + Lighthouse pass" "P1" "S" "seo,perf" "apps/landing; apps/blog" "Extend Plans 69/70 across the new pages."
create_issue "M1" "Product-analytics funnel + founder dashboard" "P0" "M" "analytics,growth" "apps/dashboard; apps/telemetry" "Track install -> connect -> first advisor recommendation -> paywall hit -> upgrade. Baseline stars/installs/followers. Do first — extends Plan 62."
create_issue "M2" "5-min-of-ClickHouse blog engine (first 8 posts)" "P1" "L" "content,marketing" "apps/blog" "8 cornerstone posts, each -> 5-min video + X thread + Slack snippet. Extends Plan 67."
create_issue "M3" "MCP registry listings + one-command install" "P1" "S" "mcp,distribution,marketing" "apps/mcp; README.md" "List the MCP server on the official MCP Registry, PulseMCP, cursor.directory, Smithery/Glama. Add 'claude mcp add' + Cursor snippet to README. Competitor-free distribution channel."
create_issue "M4" "README-as-landing-page + awesome-clickhouse PR" "P1" "S" "marketing,oss" "README.md" "Hero GIF of the advisor flagging a real problem, copy-paste quickstart, before/after benchmark. PR onto awesome-clickhouse; add on-ramp from duyet/clickhouse-monitoring."
create_issue "M5" "Zero-signup local diagnostics CLI" "P2" "M" "cli,growth" "rust/" "CLI runs system.query_log/system.parts diagnostics locally with no account — top-of-funnel wow that becomes a Show HN artifact."

echo
echo "Done. Dry-run by default; re-run with --apply to create. Repo: $REPO"
