# Desk playbook: babysit PRs

Keep every open PR moving to merged. This job is the *conveyor*, not the
triage: it fixes CI, answers review comments, and arms auto-merge. It never
files new work and never starts a feature.

Runs every 30 minutes, so every step must be cheap and idempotent. If there
is nothing to do, write that down and stop — an empty run is a good run.

## Sweep

1. `git fetch origin --prune` and `git pull --ff-only origin main` in the main
   checkout. If the checkout is not a clean `main`, write the blocker in
   `summary.md` and stop.
2. `gh pr list --state open --limit 40 --json
   number,title,headRefName,isDraft,mergeStateStatus,reviewDecision,statusCheckRollup`.
   Group by what each PR needs next:

   | State | Do |
   |---|---|
   | Required check red | Fix it (below) |
   | Required green, no auto-merge | Arm it (below) |
   | Changes requested | Read the review, fix it or answer it |
   | Merge conflict | Fix it on the branch |
   | Stale (no update > 3 days) | Nudge, or close with a reason if dead |
   | Draft, abandoned | Close with a reason, link the issue |

3. **Required checks are `unit-tests` and `dashboard`.** `e2e-test`,
   `e2e-test-tsr`, `component-test`, `codecov/patch`, `promptfoo`, and
   `Claude Issues` are informational. Never hold a PR for one of them, and
   never spend a run fixing one.
4. **Arming auto-merge.** Only when *both* required checks are green and the PR
   is not a draft:

   ```sh
   gh pr merge <n> --auto --squash
   ```

   Never arm release-please. The release PRs (`chore(main): release …`) are
   human-only, by standing instruction.
5. **Fixing a red required check.** Read the log first
   (`gh run view <run> --job <job> --log-failed`, or
   `XDG_CACHE_HOME=/private/tmp/gh-cache gh run view …` when the cache dir is
   restricted). Reproduce the failure locally only if it is cheap. Prefer the
   `fix-ci` and `babysit` skills over improvising.
6. **Review comments.** A bot reviewer (`coderabbitai[bot]`, Sourcery, Gemini)
   that leaves `CHANGES_REQUESTED` may be dismissed **only** when every point is
   genuinely fixed or stale, all required checks are green, the branch is
   current with `main`, and the bot did not re-review after your push. Never
   dismiss a human review. See AGENTS.md § Stale bot-review gate.
7. After a merge lands, tell any still-open child that `main` moved so it
   rebases instead of piling up conflicts.

## Worktree hygiene

The desk is allowed to grow worktrees, so it is also responsible for not
leaving them behind. After a PR merges and nothing remains for it:

```sh
git worktree remove ~/.herdr/worktrees/chmonitor/<name>
git branch -D <branch>          # only after the branch is merged
```

Before removing, prove the branch landed — a squash merge changes the sha, so
`git branch --merged main` is not enough:

```sh
git diff <branch> origin/main -- $(git diff --name-only \
  $(git merge-base origin/main <branch>) <branch>)   # empty = landed
```

**Never remove a worktree with uncommitted work.** Commit it to its own branch
first (a `wip(...)` commit is fine, local only) so the work cannot be lost.

## Report

Write `changes.md`: armed / fixed / nudged / closed / skipped + why, and any
worktree added or removed. Then toast:

```sh
herdr notification show "chmonitor PRs" --body "{{runDir}}/changes.md"
```

## Stop conditions

Stop and report instead of pushing harder when:

- a required check has been red for 3 consecutive runs — that is a real bug,
  so open an issue with the failing log rather than a fourth fix attempt
- the same bot review cycles twice — escalate to an issue
- more than 3 PRs are red at once — fix them in order of age, not breadth
