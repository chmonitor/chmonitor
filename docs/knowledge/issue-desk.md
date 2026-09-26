---
id: issue-desk
title: Scheduled Herdr desk (external CLI)
type: workflow
status: active
updated: 2026-09-27
tags:
  - herdr
  - cron
  - agents
  - github
  - automation
related:
  - core-memory
  - conventions
  - deployment
  - product-design
---

# Scheduled Herdr desk

Unattended maintenance is the **herdr-desk Herdr plugin** — an external CLI, not
code in this repo. This repo contributes `.herdr-desk.json` (config only) and
the repo-owned playbooks under `docs/herdr-desk/`.

```bash
herdr plugin install duyet/herdr-desk
herdr plugin action invoke herdr-desk.start
herdr plugin action invoke herdr-desk.status
herdr plugin action invoke herdr-desk.last      # today's changes.md
herdr plugin action invoke herdr-desk.history   # per-fire ok/fail + error
```

State: `.herdr-desk/runs/<task>/YYYY-MM-DD/` (gitignored), plus the ledger
`~/.local/state/herdr/plugins/herdr-desk/runs.jsonl`.

## The four jobs

| Job | Cron | Agent | Playbook |
|---|---|---|---|
| `desk:github-issues` | `0,30 * * * *` | `chm-desk` | bundled `github-issues` |
| `local:babysit` | `10,40 * * * *` | `chm-babysit` | `docs/herdr-desk/babysit-prs.md` |
| `local:prod` | `20,50 * * * *` | `chm-prod` | `docs/herdr-desk/prod-watch.md` |
| `local:improve` | `17 2 * * *` | `chm-improve` | `docs/herdr-desk/improve.md` |

Minutes are staggered so two jobs never contend for the same slot, and each job
has its **own `agentName`** because the agent name *is* the session identity:
one name shared by two jobs means two prompts racing for one manager pane.

## Why the jobs are split this way

The 0.1.x desk had one job doing triage, CI fixing, review, and merges. It
worked, but every duty competed for the same five child slots, so a busy issue
queue silently starved PR maintenance. The split gives each duty its own budget
and its own manager, and it makes "which job is broken" answerable — one row of
`status` per job.

## Failure mode this repo has already paid for

**A desk that fails looks exactly like a desk with nothing to do.** Between
2026-08-21 and 2026-09-24, 24 consecutive chmonitor fires failed with

```
EISDIR: illegal operation on a directory,
open '.../.herdr-desk/runs/github-issues/LATEST'
```

`execute()` wrote the run pointer with a bare `writeFileSync`, so a *directory*
left at that path made every later fire die before the manager was ever
prompted. 35 of 40 run directories in that window were empty. It recovered by
accident — a config edit plus a 0.1.3 reinstall happened to clear the path.

Two lessons are now encoded rather than remembered:

1. herdr-desk #15 makes the pointer write clear whatever is there first, and
   adds a **`Fails` column** to `status`: consecutive failed fires since the
   last success, with the start date. Replayed against the real ledger that
   column reads `12 from 2026-08-21` … `24 from 2026-08-21`.
2. `local:improve` checks desk health as its **first** source of findings,
   because every other job on the list depends on it.

Corollary: `Next: -` in `status` means the cron can never match. That is always
a config bug, not a schedule that is merely far away.

## The ledger is thin — read `changes.md`, not `runs.jsonl`

`runs.jsonl` records `{prompted: true}` or `{spawned: true}` and nothing about
what the manager then did. It cannot answer "did the desk land anything", and
`spawned: true` is not a result. The per-day `changes.md` in the run dir is the
real record: opened / merged / research-only / skipped-and-why. Typed ledger
fields are scoped in the 0.2 design (`herdr-desk/docs/design.md` §9), not
shipped.

## Identity is not cosmetic

`name` in `.herdr-desk.json` is the desk's identity in the ledger, in
`status`, and — because `runs.jsonl` keys on it — in the run directory. When
`herdr-desk/.herdr-desk.json` still said `"name": "chmonitor"`, that repo
registered a *second* `chmonitor` job on a different cron, and both prompted
`chm-desk` at 17:00:15 on 2026-09-26; the loser recorded a prompt failure.
**`name` must equal the repo folder name.**

## Worktrees

The desk creates `~/.herdr/worktrees/chmonitor/desk-<task>` for its managers and
one per dispatched child. The `desk-*` ones are long-lived and reused across
ticks — never remove them by hand. Child worktrees are the desk's to clean, and
AGENTS.md § Worktree hygiene is the rule it follows: never remove a worktree with
uncommitted work, and prove a branch landed with a `git diff` against
`origin/main` rather than `git branch --merged`, because squash merges change the
sha.

## What this job must never do

- Never auto-merge a release-please PR (standing instruction, this repo and the
  plugin repo).
- Never deploy a feature. Deployment is `.github/workflows/cloudflare.yml` on
  push to `main`; `local:prod` may only verify, or restore service by revert.
- Never change a model default, a quota, or a secret. File it.
- Never implement `needs-design`.
- Never run heavy local Node/build/test tasks — CI owns those.
