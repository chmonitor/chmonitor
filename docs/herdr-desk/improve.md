# Desk playbook: improve

The self-improvement loop. This job makes the repository and its own
automation better; it does not ship product features. Product work belongs to
`desk:github-issues`.

Runs nightly. One theme per run, fully verified, then stop. A night that files
three good issues and lands one small fix beats a night that touches forty
files.

## What counts as an improvement

Five sources, checked in this order. Do not invent a sixth.

1. **Desk health.** `bun <plugin>/src/cli.ts status` (or
   `herdr plugin action invoke herdr-desk.status`) — the `Fails` column
   non-empty, a `Next` of `-` (a cron that can never match), or a job whose
   manager is not live. A desk that is quietly failing is the most expensive
   possible finding, because every other job on this list depends on it.
2. **The desk's own trail.** `.herdr-desk/runs/*/changes.md` for the last
   three days. Every "skipped + why" and every "needs a human" is a candidate.
3. **Drift between a rule and the code.** AGENTS.md, `.claude/skills/*/SKILL.md`
   and `docs/knowledge/*.md` are a contract. A skill that points at a path that
   no longer exists is a bug: grep for the paths each skill names and fix the
   ones that moved. (This has already happened — see `git log` for the
   `verify-deploy` path fix.)
4. **Dead weight.** Code with no non-test caller, a comment that contradicts the
   code below it, a duplicated helper, a test asserting behaviour nothing uses.
5. **Slowdowns.** A workflow that got slower, a query that scans more than it
   used to, a bundle that grew. `docs/knowledge/core-memory.md` holds the
   standing recipes and the known-false-positive list.

## The loop

```
measure → pick the single top item → research → fix or file → verify → record
```

1. **Measure.** Produce the evidence before you claim anything. A file path, a
   `rg -n` hit, a failing command, a CI log line. No evidence, no finding.
2. **Pick one.** Rank by (certainty × blast radius) ÷ effort. If two items tie,
   take the one whose absence would keep biting.
3. **Research before you touch.** Read the code, the tests, and the docs that
   claim the old behaviour. If the right output is a decision rather than a
   diff, write `research-<n>.md` in the run dir and stop. Do not guess a
   product decision at 02:00.
4. **Fix or file, not both.** A mechanical fix (stale path, dead code, missing
   test for a rule that already exists) gets a PR. Anything needing judgement
   gets an issue with the evidence attached.
5. **Verify.** CI is the gate — do not run heavy local Node/build/test tasks.
   For doc-only and skill-only changes, state plainly in the PR that no runtime
   behaviour changed, and let `unit-tests` + `dashboard` confirm.
6. **Record.** Update the knowledge note you touched, in the same change, and
   bump its `updated:` date. A finding that is not written down will be
   rediscovered next month.

## Never

- Never open a PR that mixes a fix with a rename, a reformat, or a dependency
  bump. Those land as their own PR or not at all.
- Never "improve" by deleting a test to make a suite green.
- Never bump a version, touch `.env*`, or edit `wrangler.toml`.
- Never touch anything under `apps/dashboard/src/routes/api/**` or
  `apps/dashboard/src/lib/auth/**` as a drive-by. Security-sensitive surface
  gets its own PR with its own review.
- Never let one run open more than 2 PRs. Breadth is how a repo stops being
  reviewable.

## Report

`changes.md` with: the theme, the measurement, what landed, what was filed
(issue numbers), what was deliberately left, and the next theme you would pick.
