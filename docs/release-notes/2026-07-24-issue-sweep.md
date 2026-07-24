# Release notes — 2026-07-24 issue sweep

All open implementable GitHub issues were resolved across 6 PRs
(#2816, #2817, #2818, #2819, #2821, #2822), closing 14 issues including the
agent-redesign epic #2811 and the scheduled-reports epic #2783.

## AI Agent page (epic #2811)

- **Persistent conversation rail** — conversations live in a collapsible side
  rail (desktop column / mobile drawer) instead of a modal, with search and
  Today/Yesterday/Previous-7-days grouping. (#2802)
- **Redesigned welcome screen** — example-prompt tile grid (icon + title +
  subtitle) and a visible brand illustration replace the near-invisible
  sparkle. (#2800)
- **Thread polish** — visible "Thinking…" pill, tool calls collapse into one
  disclosure group, legible message-stats footer, 64rem content-width cap. (#2803)
- **Composer polish** — card chrome, keyboard hints (Enter / Shift+Enter / ⌘K),
  send↔stop button, toolbar kept mid-conversation. (#2804)
- **Standard chart cards for agent visualizations** — the duplicate
  AgentChartRenderer was retired; inline agent charts now use the dashboard's
  card surface and shared empty/error states. (#2805)
- **Unified surfaces** — suggested prompts, daily AI usage, and recent threads
  each render from one shared component across welcome, composer, and settings. (#2809)
- **OKLCH token migration** — all hardcoded palette colors in the agent UI
  moved to design tokens, fixing dark-mode hue jumps. (#2801)

## Reports

- **PDF export via Cloudflare Browser Rendering** — download from
  /report-settings, the report API (`format=pdf`), or auto-attached to Pro+
  scheduled email delivery. Fail-closed optional: deployments without the
  `BROWSER` binding keep HTML. (#2794)
- Scheduled cluster insights reports epic closed as delivered — subscriptions,
  monthly cron, per-user delivery, agent narrative shipped previously in #2814. (#2783)

## Design & illustrations

- **Illustration system** — theme-aware, token-driven, motion-safe inline SVG
  illustrations (`components/illustrations/`) plus an `assets/illustrations/`
  convention for static site art. (#2806)
- **Distinct empty/error states** — each EmptyState/ChartError variant gets a
  bespoke mini-illustration; chart failures show a cause-appropriate one
  (timeout vs offline vs missing table). (#2807)
- **Connection errors illustrated** — the ConnectionErrorPanel shows a
  broken-wire diagram indicating which hop failed (network vs source). (#2808)

## Landing

- **Hero brand backdrop** — subtle tessellated six-bar equalizer motif behind
  the hero; ~1.6 MB of orphaned hero background images removed. (#2810)

## CLI

- One-line install (`curl -fsSL …/scripts/install.sh | bash`) and crates.io
  publishing were already shipped (#2731/#2745); #2699 closed as code-complete.
  **Blocked on maintainer:** `git push origin chm-v0.1.0` to cut the first CLI
  release (#2727, still open).

## Post-merge code review fixes (#2821)

- Plan-gate bypass closed: `GET /api/v1/insights/weekly-report?format=pdf` now
  requires the Pro+ `data_export` capability like the POST route.
- PDF filename argument misuse, missing catch handlers in report settings,
  React key collisions in prompt tiles, composer corner radius per spec.
- During integration: fixed a `Uint8Array` `BodyInit` type error and added
  `useAssistantRuntime` to the SSR client-only stub export allowlist.
