---
id: release-automation
title: Release Automation Pipeline
type: workflow
status: active
updated: 2026-08-19
tags:
  - release
  - ci
  - release-please
  - changelog
  - versioning
related:
  - deployment
  - conventions
---

# Release Automation Pipeline

How chmonitor versions, tags, builds, and publishes releases. Fully automated
from conventional commits on `main` — no manual version bumps or tagging.

## Flow

1. **Commits land on `main`** (squash-merged PRs; the **PR title becomes the
   commit**). Conventional-commit type drives everything downstream.
2. **release-please** (`.github/workflows/release-please.yml`) watches `main`
   and maintains a standing `chore(main): release X.Y.Z` PR plus the tracked
   `CHANGELOG.md`. Config + manifest live under `.github/`:
   `.github/release-please-config.json` and `.github/.release-please-manifest.json`
   (moved out of repo root 2026-06-13 to keep root clean; the workflow passes
   `config-file` / `manifest-file` explicitly).
3. **Merging the release PR** tags the version and publishes a GitHub Release.
4. **`release.yml`** is **explicitly dispatched** by the release-please job
   (`gh workflow run release.yml -f tag=<tag>` when `release_created == true`,
   needs `permissions: actions: write`).
   ⚠️ **Gotcha:** GitHub does **not** trigger other workflows from a release or
   tag created with the default `GITHUB_TOKEN` (anti-recursion), so the
   `on: release: published` trigger alone does **not** fire — without the
   explicit dispatch the versioned Docker images + release assets are silently
   never built (this bit v0.2.7, recovered with a manual `workflow_dispatch`).
   It builds multi-arch Docker images
   (`ghcr.io/chmonitor/chmonitor` + `ghcr.io/chmonitor/chmonitor`), packages
   standalone + Cloudflare archives + `SHA256SUMS`, then delegates **all
   release-notes generation + publishing** to the shared
   [`duyet/llm-release-action@v1`](https://github.com/duyet/llm-release-action)
   composite action (recap stats, tiered AI summary, Docker block, compare link,
   and the migration prompt). The recap/notes scripts and tiered-inference steps
   used to live in-repo (`scripts/release-recap.mjs`,
   `scripts/generate-release-notes.ts`) and are now centralized in that action.

## Release body layout

The action renders the body in this order:
`AI Highlights/summary + Features/Fixes/Perf` → `## 📊 Release recap` (hard
stats) → `## 🐳 Docker image` (`docker pull` + `FROM` pin, tag = release
version) → `## 🔁 Full changelog` (compare link `PREVIOUS_TAG...RELEASE_TAG`)
→ build footer.
Repo-specific prompts (`.github/release-notes-prompt.md`,
`.github/release-notes-system-prompt.md`, `.github/release-migration-prompt.md`)
are passed to the action via its `*-prompt-file` inputs. The dashboard What's
new dialog (`GET /api/v1/releases`) displays the GitHub Release body after
stripping recap/Docker/internal sections.

## LLM summary tiers (best-effort, never blocks a release)

The action calls `actions/ai-inference@v2` in order; the first non-empty wins:

1. **GitHub Copilot** (`provider: copilot`)
2. **GitHub Models** (`provider: github-models`)
3. **AnyRouter** — only when the `ANYROUTER_API_KEY` secret is set:
   `endpoint: https://anyrouter.dev/api/v1`, model from `vars.ANYROUTER_MODEL`
   (default `openai/gpt-4o-mini`), with **app-attribution headers per the
   AnyRouter docs** — `X-AnyRouter-Source: chmonitor`, `X-AnyRouter-Title`,
   `X-AnyRouter-Version` (= release tag), `X-AnyRouter-Categories: programming-app`.

The prompt asks for product **Highlights / summary** first (plus Features /
Fixes / Perf), and to skip refactors, CI, and other internal-only work.
Recap stats, Docker, and the compare link stay **below** the AI notes.
`models: read` permission is required.

## Release recap stats

The action's `release-recap.mjs` writes `recap.md` (rendered) + `recap-facts.txt`
(fed to the LLM): commit / PR counts, day span + pace, day-vs-night split,
contributors, review comments back and forth, agents involved, and a shoutout to
the most active AI agent (its comments / reviews / approvals). The same logic is
shared verbatim across every duyet repo via `duyet/llm-release-action`.

## Versioning rules (release-please config)

- Pre-1.0 semantics: `bump-minor-pre-major: true`,
  `bump-patch-for-minor-pre-major: true`. So in `0.x`, **`feat` bumps patch**;
  only a **breaking change** (`feat!:` / `fix!:` / `BREAKING CHANGE:` footer)
  bumps the **minor** (e.g. `0.2.x → 0.3.0`).
- To intentionally cut `0.3.0`, the triggering commit must be a breaking change.
- `changelog-sections` map commit types → emoji sections; `docs/chore/test/ci/
  style/refactor` are hidden from the dashboard package changelog.

## Guards that keep it reliable

- **`pr-title.yml`** validates every PR title against `commitlint.config.js`
  (the same config the local husky hook uses — one source of truth). Because
  squash-merge turns the title into the release-please commit, an invalid title
  would be silently dropped from the version bump + changelog.
- **`labeler.yml`** (+ `.github/labeler.yml`) path-labels PRs for triage /
  release grouping (`app: dashboard`, `area: ci`, `documentation`, etc.).

## CHANGELOG convention

`CHANGELOG.md` is **owned by release-please** for versioned entries. The
`## [Unreleased]` section at the top is human-curated (e.g. the v0.3 breaking
-change preview) — release-please leaves it alone and inserts the generated
version block above it on release. Don't hand-edit released version blocks.
Do not reintroduce changesets.

`## [Unreleased]` **may** include a `### Highlights` subsection with short
user-facing bullets and optional markdown screenshots (`![alt](url)`). Those
highlights are the source for the GitHub Release opening summary and the
in-dashboard What's new dialog. Keep Highlights product-facing — no refactor /
CI / chore dumps.

## Migration prompt (AI-assisted upgrades)

`.github/release-migration-prompt.md` is the canonical paste-able prompt that
rewrites a user's env for a breaking upgrade. It is surfaced in **three** places,
kept in sync: the GitHub Release body (auto-appended), `README.md`
(`#upgrading-to-v03`), and `docs/content/migrating/v0-3.mdx`. Update all three
together when the migration rules change.

## Dead tooling note

`.changeset/` + `@changesets/cli` were removed 2026-06-13 — release-please fully
replaced changesets. Do not reintroduce changesets.
