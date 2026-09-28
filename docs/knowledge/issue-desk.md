---
id: issue-desk
title: Scheduled Herdr desk (external CLI)
type: workflow
status: active
updated: 2026-09-28
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

## Two ways a desk dies silently

**A desk that fails looks exactly like a desk with nothing to do.** It has
happened twice, for unrelated reasons, and `Fails` cannot tell you which one you
have. Read the error; the counter is not a diagnosis.

### A directory where the run pointer belongs (EISDIR)

Between 2026-08-21 and 2026-09-24, 24 consecutive chmonitor fires failed with

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

### The agent name is taken and no session can be found (`agent_name_taken`)

On 2026-09-28 `local:prod` died of a cause with nothing in common with the one
above, and `status` showed `Fails 19 from 2026-09-28` and nothing else:

```
2026-09-28T08:57:15.403Z  herdr agent start chm-prod --kind opencode --pane wAY:p1
  --timeout 180000 failed (1): {"error":{"code":"agent_name_taken",
  "message":"agent name chm-prod is already used; candidates: terminal_id=term_65c7a29e1e3325b
  pane_id=wAY:p1 workspace_id=wAY tab_id=wAY:t1 cwd=/home/duyet/.herdr/worktrees/chmoni…"}}
...
2026-09-28T08:58:50.444Z  (same, last of the burst)
```

Thirty-one failures in 95 seconds, then a self-recovery at `09:49:51Z` with
`{"prompted":true}` and no intervention. Four things a reader cannot guess:

- **The tell is inside the error.** It names a session sitting in its own pane —
  `pane_id=wAY:p1`, `cwd=…/chmonitor/desk-local-prod` — while `herdr agent list`
  does not surface it. The desk can see the name is taken, cannot find a session
  to prompt, and its only remaining move is `agent start`, which is refused. The
  desk is not stuck deciding; it is stuck with nothing left to try.
- **It is transient, so recovery is indistinguishable from never having broken.**
  A non-zero `Fails` on a row that is healthy right now may be this and nothing
  else — and by 17:05 every chmonitor row read `Fails -` again. Do not tell
  yourself to wait it out: the cost was the fires of the one job whose purpose is
  catching a bad production deploy, lost while `chm-prod` was mid-investigation
  of a live outage.
- **`Fails` is a floor, not a count.** `status.ts:16` calls `loadRuns(200)`,
  `history.ts:15` caps at `MAX = 200`, and `failureStreak` (`history.ts:92`)
  counts back over that slice. The slice is the last 200 records *globally* —
  every repo, every job — so on a busy machine a streak is truncated from the
  front. Measured: 1009 records in the ledger, the burst at lines 696–726, 283
  records after it. When the row read `Fails 19` at 09:48, exactly 19 of the 31
  were still inside the window; the other 12 had already scrolled out. The count
  is lowest when the machine is busiest, which is when a reader most needs it.
- **Nothing in this repo can fix it.** The repair is in the plugin, and it is
  filed upstream ([duyet/herdr-desk#32](https://github.com/duyet/herdr-desk/issues/32)),
  not here. This note exists so the next reader recognises the shape instead of
  re-deriving it from a `Fails` count.

## When a job misbehaves, first ask whether the plugin is on a commit

The desk is **an external CLI, not code in this repo** (see the top of this
note). That line is usually read as a boundary; it is also a first debugging
step. Our config can be perfect and the code that reads it can be a working
tree.

The fix for the mode above — `isManagerCheckout` at `herdr-desk/src/run.ts:436`,
which accepts Herdr's dashed directory spelling (`desk-local-prod`) so a finished
manager matches its own checkout — is in the herdr-desk working tree and in no
commit. The two commands that show it:

```sh
cd /home/duyet/project/herdr-desk
git show HEAD:src/run.ts | grep -c isManagerCheckout   # → 0
git diff --stat                                            # 238 insertions, 5 untracked
```

238 changed lines and five new modules (`failures.ts`, `health.ts`, `queue.ts`,
`chart.ts`, `dashboard.ts`), unreviewed, and they schedule every job in the
desk, across 9 repos. HEAD at the time was `ad73bd6c chore(main): release 0.1.6
(#27)`, committed four minutes before the burst started. So: **is the plugin
even on a commit?** before asking whether our config is right. `hd-desk` owns
that repository's review process; this note only records that the answer was no.

## The ledger is thin — read `changes.md`, not `runs.jsonl`

`runs.jsonl` records `{prompted: true}` or `{spawned: true}` and nothing about
what the manager then did. It cannot answer "did the desk land anything", and
`spawned: true` is not a result. The per-day `changes.md` in the run dir is the
real record: opened / merged / research-only / skipped-and-why. Typed ledger
fields are scoped in the 0.2 design (`herdr-desk/docs/design.md` §9), not
shipped.

**But a record still has to be checked.** Tick 1 of `local:improve` on
2026-09-28 wrote in its `summary.md`: *"**3 issues** — herdr-desk timezone;
`CHM_API_KEY_SECRET` provenance; the dangling `agent-model-discovery` edge"*, and
spawned one child for a prod-playbook PR. Checked five hours later:

| Claimed | Actual |
|---|---|
| 3 issues filed | 0, on both repos |
| 1 child → 1 PR | 0. No branch, no worktree, no agent, no PR |

The rule: **before acting on a handoff, or writing that a handoff closed,
confirm it landed.** One `gh issue list`, one `gh pr list --state all`, and for a
child one `git worktree list`. The cost is asymmetric — a `summary.md` that
reports unlanded work as landed is worse than an empty one, because the next run
reads it, sees the work covered, and skips it. Three findings became unowned
because one sentence said they were filed.

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
