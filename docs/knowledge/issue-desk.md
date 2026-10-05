---
id: issue-desk
title: Scheduled Herdr desk (external CLI)
type: workflow
status: active
updated: 2026-10-05
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

## The eight jobs

| Job | Cron | Agent | Playbook | Owns |
|---|---|---|---|---|
| `desk:github-issues` | `0,30 * * * *` | `chm-desk` | bundled `github-issues` | triage, research, dispatch children |
| `local:babysit` | `10,40 * * * *` | `chm-babysit` | `docs/herdr-desk/babysit-prs.md` | red required CI, review replies, auto-merge, worktree cleanup |
| `local:prod` | `20,50 * * * *` | `chm-prod` | `docs/herdr-desk/prod-watch.md` | live-deploy verification, agent probe, usage, revert on regression |
| `local:improve` | `17 2 * * *` | `chm-improve` | `docs/herdr-desk/improve.md` | desk health, dead code, slowdowns |
| `local:secrets` | `6 6 * * *` | `chm-secrets` | `docs/herdr-desk/secrets.md` | every `secrets.*` a workflow references vs. what exists; workflows with zero successful runs |
| `local:red-jobs` | `26 7 * * *` | `chm-redjobs` | `docs/herdr-desk/red-jobs.md` | the CI jobs babysit is forbidden to spend runs on; classifies each as repo defect or external fact |
| `local:stale-issues` | `34 9 * * *` | `chm-stale` | `docs/herdr-desk/stale-issues.md` | closes stale-bot / fixed / superseded / duplicate issues with a reason |
| `local:docs` | `46 3 * * *` | `chm-docs` | `docs/herdr-desk/docs-drift.md` | prose-named dead paths, dangling `related:` ids, stale notes |

Minutes are staggered so two jobs never contend for the same slot, and each job
has its **own `agentName`** because the agent name *is* the session identity:
one name shared by two jobs means two prompts racing for one manager pane. The
new jobs' minutes (`6, 26, 34, 46`) were also checked against every other desk
on this host, not just this repo.

### Why the last four exist

Each closes a specific hole where a failure is invisible *because* nothing
depends on it — which is exactly what makes it rot.

- **`local:secrets`.** `claude-issues.yml` referenced
  `secrets.ANTHROPIC_API_KEY`, which was never in the repo. It failed **100
  runs out of 100** across three days and nobody saw it, because no required
  check depends on that workflow, so `local:babysit` never looks at it (#3488).
  A referenced-but-absent secret is a one-line `comm` check; the job exists so
  it stops being a one-line check nobody ever runs.
- **`local:red-jobs`.** Babysit is *forbidden* to fix non-required checks. That
  is right for throughput and wrong for ownership: with no owner, red
  informational jobs decay into background noise. Its core duty is the
  classification — a code defect gets an issue, an external fact (a gateway
  `404 model_unavailable`) does not, because a stale "the eval is broken" issue
  is itself rot.
- **`local:stale-issues`.** `desk:github-issues` triages what *arrives*; nothing
  pruned what accumulated. Issue #14 is a Renovate dashboard from 2023-11-18,
  still open, listing PRs against a repository name this project no longer has.
- **`local:docs`.** Splits doc drift in two so the halves do not duplicate.
  `tests/repo/markdown-links.test.ts` **gates** relative markdown links in the
  required `unit-tests` job. `local:docs` owns the three classes a deterministic
  check cannot reach — paths named in prose, `related:` frontmatter ids with no
  matching note, and notes that now contradict the code.

## Why the jobs are split this way

The 0.1.x desk had one job doing triage, CI fixing, review, and merges. It
worked, but every duty competed for the same five child slots, so a busy issue
queue silently starved PR maintenance. The split gives each duty its own budget
and its own manager, and it makes "which job is broken" answerable — one row of
`status` per job. The same reasoning drives the four later additions: a duty
with no owner is a duty that silently rots, and adding capacity to the busiest
job would only make the starvation worse.

## Four ways a desk dies silently

**A desk that fails looks exactly like a desk with nothing to do.** It has
happened four times, for unrelated reasons, and `Fails` cannot tell you which
one you have. Read the error; the counter is not a diagnosis. Twice the error
was there to read, and the third time it was not. The fourth leaves nothing to
read at all — no failure, and no number either.

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

Thirty-one failures in 95 seconds, then a self-recovery at `09:49:41Z` with
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

### The daemon dies outright, and the restart writes `ok`

From `2026-09-28T16:00:21.697Z` to `2026-09-29T19:41:49.984Z` — 27h41m, or
2026-09-28 23:00 to 2026-09-30 02:41 in `Asia/Ho_Chi_Minh` — `daemon.log` has
these two lines and nothing in between:

```
2026-09-28T16:00:21.697Z hub sent (🔴 5 running · 5 stuck · 3 done · 2 skipped · 3 blocked · 1 failed)
2026-09-29T19:41:49.984Z daemon start pid=129060
```

The host did not reboot — `last -x reboot` shows the last boot at 2026-09-05,
still running — and `earlyoom` names the process that stopped:

```
Sep 28 23:04:19 duet-ubuntu earlyoom[1729719]: sending SIGTERM to process 102956 uid 1000 "bun": badness 968, VmRSS 44 MiB
Sep 28 23:04:19 duet-ubuntu earlyoom[1729719]: process exited after 0.1 seconds
```

`102956` is the pid the daemon logged for itself at
`2026-09-28T15:58:37.697Z daemon start pid=102956`. `runDaemon` installs a
SIGTERM handler that exits without writing a line (`daemon.ts:313-322`), so a
kill under memory pressure ends the desk as quietly as a clean shutdown.
Nothing restarted it. `pid 129060` is there only because the plugin directory
was replaced at 02:41:44, five seconds before the new `daemon start`, and
`herdr-desk.start` was invoked; the update check then recorded
`manual 0.1.6 -> v0.1.6` in `update-check.json` — the same version, and the check
calls it `manual`. The daemon's own auto-update path never ran.

149 chmonitor fires never happened on 2026-09-29 — one full local day of this
desk's schedule, 48 each for `desk:github-issues`, `local:babysit` and
`local:prod`, plus one for each of the five daily jobs, counted with the
plugin's own `cronSlotsToday` against that date. Five more were still ahead on
09-28 when it died. Every desk on the host went dark for the same window.

Six things a reader cannot guess:

- **The gap is invisible by construction, and provably not a prune.**
  `tickOnce` computes `day = dayKey(at)` once (`daemon.ts:213`) and builds every
  plan from `cronSlotsToday(expr, at)`, which walks `at.getHours()` and takes no
  date (`cron.ts:195-211`), while the ledger key is
  `repo::task::cron::day::slot` (`daemon.ts:154-162`). A 09-29 slot is not in the
  query at all, so a restart cannot learn that yesterday was missed. The result
  measures: `fires.json` holds **no key dated 2026-09-29** for any repo, while
  its oldest retained day is 2026-09-22 — eight days back, matching
  `FIRE_KEEP_DAYS = 8` (`daemon.ts:24`, `pruneFires` at `daemon.ts:64-78`).
  chmonitor's per-day key count across 09-28 / 09-29 / 09-30 is 140 / **0** / 18.
- **What the restart wrote was `ok`.** Three write-off lines for chmonitor — 5,
  5 and 4 slots, every one of them a 2026-09-30 slot — then four fires, each
  `ok {"spawned":true}`. `catchUpPlan` (`daemon.ts:173-180`) runs the newest
  missed slot and consumes the rest, so the recovery log is what an ordinary
  first tick of the day looks like, and nothing in it says 27 hours went missing.
- **`status` cannot disagree, because it only reads the last record.** `Last` is
  `last.at.slice(0, 16)` and `Fails` is `-` whenever the streak is zero
  (`status.ts:37`, `status.ts:41-44`), so every chmonitor row read
  `ok 2026-09-29 19:41` beside a `-`: the check AGENTS.md prescribes. `Last` is
  UTC while `Next` is local (`status.ts:9-13`), so that row also puts the last
  fire seven hours and one calendar day before the rest of the table.
- **The table has no liveness column to notice with.** `formatSchedule` fills
  `Next` from `cronNext` and `Last` and `Fails` from `runs.jsonl`
  (`status.ts:15-62`); the process that writes those rows is not one of the
  inputs. Its only liveness reading is the `daemon: running (pid N)` line
  `cli.ts:383` prints above the table, which is true whenever you happen to look
  — and for 27 hours nobody did.
- **There is no `restart stale daemon` line to go looking for, and there would
  not be one.** `startDaemon` logs it only when `daemonPid()` returned a live
  pid (`daemon.ts:383-388`), and `daemonPid` returns null for a dead one
  (`daemon.ts:42-52`). The startup line is `daemon start pid=…`
  (`daemon.ts:312`) and carries no "dark since".
- **Nothing in this repo can fix it.** The repair belongs to the plugin, and is
  filed on duyet/herdr-desk. This note exists so the next reader recognises the
  shape from a green table instead of re-deriving it from a 27-hour silence.

### The health gate holds a job, and six hours later the queue gives up

Found 2026-10-05, and the quietest of the four: **no number at all.** A busy
box is not a failing desk, so `Fails` reads `-` for the whole window and the
slot simply does not run at its cron minute. Only a `daemon.log` line says
anything, and it says it once, six hours late:

```
2026-10-05T01:17:05.806Z give up local:improve: held since 2026-10-04T19:17:05.263Z without running
```

That is `local:improve` on chmonitor — held from its own `02:17` slot, given up
at **08:17 local**, `MAX_HELD_MS` to the second.

#### The mechanism

`tickOnce` checks health *immediately before each fire*, not once per tick,
because a tick can run for minutes. `check()` in `health.ts` closes the gate on
any of three readings, from `defaultBudget()`: load over **1.5/core**,
`memAvailable()` under **3 GB** (or 15% of RAM, whichever is larger), or more
than **24** live Herdr agents. Every entry currently in `queue.json` is held on
that last reading alone — 26, 28 or 29 agents against the limit — which is what
a desk that fans out children looks like from the outside.

A closed gate is a *hold*, not a drop. `tickOnce` calls `hold()` and
deliberately does **not** write the slot's `fires` key, so the slot stays due,
and logs `hold <repo>/<task> slot <slot>: <breaches>` — which names the repo,
unlike the line that follows. The queue's contract is that a held job is retried
on later ticks, oldest first, one per tick in `retryHeld()`.

Then the six hours end. `MAX_HELD_MS` in `queue.ts` is `6 * 60 * 60 * 1000`,
and `hold()` deliberately **keeps the original `since`** when a job is re-held,
so the age is the age rather than the most recent attempt — the `tries`
counter alone would never reach the limit. `view()` moves anything past
`MAX_HELD_MS` into `expired`, and writes the queue back **without it**.
`retryHeld()` logs one line per expired entry:

```
give up <task>: held since <ISO> without running
```

Five things a reader cannot guess:

- **The window is six hours, and a daily job cannot outrun it.** `MAX_HELD_MS`
  is a quarter of the 24h between two daily slots, so a daily job's retry debt
  always expires long before its next slot exists — the queue is sized to cover
  a busy tick or two, not a busy morning. What the six hours buy is one line in
  the log and, if the gate is still shut on the next tick, a fresh clock. Four
  of chmonitor's audit jobs are daily and all morning — `local:docs` 03:46,
  `local:secrets` 06:06, `local:red-jobs` 07:26, `local:stale-issues` 09:34 —
  so they are the ones with a slot to lose, in the hours the host is busiest.
- **Neither a hold nor an expiry writes anything `status` reads.** `hold()` goes
  to `queue.json`; a run writes to `runs.jsonl`, and only a run writes there. So
  `Fails`, which is `failureStreak()` counting `fail` records over
  `loadRuns(200, job)`, has nothing to count and renders `-`. `Last` still
  reads the previous successful fire. `desk status` shows `Fails -` and
  `Last: ok` for the entire window, which is precisely the check AGENTS.md
  tells you to run.
- **The give-up line omits the repo.** `retryHeld()` interpolates `gone.task`
  and nothing else, on a machine-wide desk where several repos run a job of the
  same name — here two repos each run a `local:improve`. Two give-up lines six
  minutes apart can belong to two different repos, and the log cannot say which.
  `queue.json` *does* carry `repo` per entry, and so does `queueHtml()` in the
  web dashboard; the `hold` lines carry it too. The give-up line is the one
  place that does not.
- **The ratio is not close.** Measured over the whole log on 2026-10-05:
  **93 `give up` lines, 2 `held ran` lines.** The queue is built so a job is
  retried until it runs, and in practice almost nothing gets that far.
- **Nothing in this repo can fix it.** `MAX_HELD_MS` and the log wording belong
  to the plugin. The repair is filed upstream on [duyet/herdr-desk#91](https://github.com/duyet/herdr-desk/issues/91), and this
  note exists so the next reader recognises the shape from a green row instead
  of concluding the job ran.

#### What to do when you are standing in it

You are at 03:46, the box is over budget, and `local:docs` has not run.

- **Do not wait for the give-up line, and do not read it as the end.** It
  arrives six hours after the hold and says only that the queue stopped
  retrying. The deadline that matters is **local midnight**: `cronSlotsToday()`
  offers a slot only within its own day, and after midnight the job is not run
  at all, with no line anywhere. Run it by hand at any point you do not intend
  to wait out.
- **Read `queue.json`, not `status`.** It is the only live view of what is
  owed right now, and every entry carries `repo`, `task`, `slot`, `since`,
  `tries`, and the `reason` — the reason is the host signal that is over
  budget, which is the thing to fix. `dash` renders the same data in a `queue`
  section. An entry that has already expired is gone from both, because the
  daemon's own `view()` deletes it on the next tick, which is why the log line
  is the record that survives.
- **Count `hold` lines for your job, and compare the first `since` to now.** If
  the gap is approaching six hours, run the job by hand; do not wait for the
  give-up, and do not trust `status` to tell you it was lost.
- **A give-up does not fire anything.** It deletes the queue entry. The slot
  stays due because its `fires` key was never written, so the next tick
  re-offers it and `hold()` starts a fresh six-hour clock — a daily job held
  all morning can therefore be given up on and then run normally later the same
  day. Two `give up local:improve` lines, six minutes apart, on 2026-10-05 are
  two repos' jobs, not one job dying twice.
- **Then fix the signal, not the job.** The agents count is the reason on every
  entry currently in the queue, and it is self-inflicted: it is the desk's own
  children, counted by `agentCounts()` from `herdr agent list`. A desk already
  fanning out five worktrees is the load it is complaining about.

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

The improve playbook now enforces this: `docs/herdr-desk/improve.md` step 7
("Reconcile before you stop") runs the three commands and downgrades any
unconfirmed claim to *not done*. A child that never reached a worktree is
recorded as a spawn failure.

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

That rule covers worktrees the desk *created*. It is not the full set — this
repo also accumulates git worktrees from other tooling, and none of them have a
Herdr Space, so `herdr worktree remove` does not reach them:

| Path | Origin | Reclaimed by |
|---|---|---|
| `~/.herdr/worktrees/chmonitor/desk-*` | desk manager | never — live, reused |
| `~/.herdr/worktrees/chmonitor/<task>` | desk child | `herdr worktree remove <name>` |
| `.claude/worktrees/agent-*` | Claude Code subagent sessions | `git worktree remove <path>` |
| `/tmp/claude-*/…/scratchpad/<branch>` | session scratchpad | `git worktree prune` |

Treating the Herdr rows as the whole problem is what let 16 `agent-*` checkouts
(4.3 GB) survive 30 `local:babysit` fires on 2026-10-04, plus 5 dead gitdir
records pointing at a deleted scratchpad. `.gitignore` already excludes
`.claude/worktrees/`, so nothing surfaces them; #3470 is what it cost when one
leaked a nested Biome config into the main checkout and blocked every push.

The full per-class recipe, including the stale-lock unlock order, is in
`docs/herdr-desk/babysit-prs.md` § Worktree hygiene.

## What this job must never do

- Never auto-merge a release-please PR (standing instruction, this repo and the
  plugin repo).
- Never deploy a feature. Deployment is `.github/workflows/cloudflare.yml` on
  push to `main`; `local:prod` may only verify, or restore service by revert.
- Never change a model default, a quota, or a secret. File it.
- Never implement `needs-design`.
- Never run heavy local Node/build/test tasks — CI owns those.
