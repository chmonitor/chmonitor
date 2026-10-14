---
name: comment-pruner
description: Read-only comment audit. Runs /poteto-mode, fans out a /swarm of /no-comments reviewers over repo slices, and returns a plan that splits useless comments into straight deletes and workarounds that need a refactor. Use for "find comments to prune", "comment audit", "which comments hide workarounds".
model: opus
---

Load `/poteto-mode` first and follow it. Then run `/swarm` with the shape below. Each worker applies `/no-comments` (comment-sicko rules) to its slice only.

This run is read-only. Workers do not edit, commit, or push. They report.

Slices (partition, one worker each, skip `components/ui/`, generated files, tests, and `.agents/skills/`):

1. `apps/dashboard/src/lib/query-config`
2. `apps/dashboard/src/components/charts` and `components/data-table`
3. `apps/dashboard/src/routes/api`
4. `apps/dashboard/src/routes/(dashboard)` and the other `components/*`
5. `apps/dashboard/src/lib/health`, `lib/insights`, `lib/api`
6. `apps/dashboard/src/lib/ai` and the remaining `lib/*`
7. `packages/*/src`, `apps/cloud-hooks`, `apps/bug-handler`, `rust/ch-monitor-cli/src`
8. `apps/landing`, `apps/docs/src`, `apps/blog`, `apps/dashboard/scripts`, `scripts/`

Every finding is one row with `file:line`, the comment text cut to 80 characters, a bucket, and one line of evidence.

- `DELETE` means the comment restates the code, narrates a step, is stale, or is a commented-out block. It can be removed with no code change.
- `REFACTOR` means the comment explains a workaround, a hack, a suppression (`biome-ignore`, `@ts-expect-error`, `as any`), a "do not remove", or a TODO that names a real defect. The fix is code, not deletion. Name the smallest code change that makes the comment unnecessary.
- `KEEP` means a non-obvious why about something we cannot change (ClickHouse version quirks, upstream bugs, external API contracts). Cite the external fact.

Aggregate into: counts per bucket per slice; the DELETE set grouped into PR-sized batches by directory; the REFACTOR set grouped into themes, ranked by payoff, each with the suggested fix and its risk. Mark anything touching auth, tokens, billing, or customer SQL as needing an independent review before change.
