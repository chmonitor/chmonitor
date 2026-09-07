# Plan 122: Fix broken script, stale paths, and doc drift (DX/docs batch)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- scripts/create-agent-conversations-clickhouse.ts docs/knowledge/ CONTRIBUTING.md AGENTS.md apps/cloud-hooks/.env.example`
> On mismatch, re-read live files.

## Status

- **Priority**: P2 (broken script) / P3 (rest)
- **Effort**: M (script fix dominates)
- **Risk**: LOW–MED (the script fix requires locating lost functionality — bounded STOP conditions below)
- **Depends on**: none
- **Category**: dx / docs
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3317

## Why this matters

Five independent drift items, all cheap, all actively misleading:

1. **Broken setup script**: `scripts/create-agent-conversations-clickhouse.ts:4`
   imports `createClickHouseConversationsTableSql` from
   `../apps/dashboard/lib/conversation-store/clickhouse-store` — that path does
   not exist (`apps/dashboard/lib` is not a directory; the store lives under
   `src/lib/conversation-store/`, which has d1-store/resolve-store but NO
   clickhouse table builder). `pnpm run setup:agent-conversations-clickhouse`
   crashes at import. Wired at root `package.json:46`.
2. **Wrong script path citations** (×7): knowledge notes + AGENTS.md cite
   `scripts/patch-wrangler-env.ts` at repo root; real location is
   `apps/dashboard/scripts/patch-wrangler-env.ts`. Sites:
   `docs/knowledge/deployment.md:58,165,168` (+~2 more),
   `docs/knowledge/cloud-saas-mode.md:103`,
   `.claude/skills/cloud-saas-mode/SKILL.md`, `AGENTS.md:97`.
3. **CONTRIBUTING says Node 20+** (`CONTRIBUTING.md:15`) vs engines
   `>=22.22.1` (root package.json:9).
4. **ai-agent doc path wrong** (×2): CONTRIBUTING.md and AGENTS.md instruct
   updating `docs/content/ai-agent.mdx`; real file is
   `docs/content/guide/ai-agent.mdx`.
5. **cloud-hooks env surface undocumented**: ~15 vars in
   `apps/cloud-hooks/src/env.ts:19–96` (Telegram/GitHub App/exception-watch/
   probes) absent from both the env-reference docs page and
   `apps/cloud-hooks/.env.example`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Script typecheck | `bun build --no-bundle scripts/create-agent-conversations-clickhouse.ts --target=bun > /dev/null && echo OK` | OK |
| Lint | `pnpm run lint` | exit 0 |
| Docs build (if touching content) | `cd apps/docs && pnpm run build` | exit 0 |

## Scope

**In scope**: the files named above + `apps/dashboard/src/lib/connection-store/clickhouse-store.ts`
(ONLY if restoring the helper there per Step 1b) + new test for restored helper.

**Out of scope**: rewriting env docs wholesale; changing any runtime behavior
of the conversation store; other scripts.

## Git workflow

- Branch: `advisor/122-dx-docs-batch`
- Commit: one per logical item (`fix(scripts): ...`, `docs(knowledge): ...`, ...)

## Steps

### Step 1: The setup script

1a. First hypothesis to check: the ClickHouse conversations backend may have
    been removed entirely (STATUS-era refactor). Grep
    `rg -n "createClickHouseConversationsTableSql\|conversations" apps/dashboard/src/lib --glob '*.ts' | head -20`
    and read what exists.
1b. If a ClickHouse conversations store exists under another name/path → move
    or re-export the CREATE TABLE SQL builder into it (or the script), fix the
    import, add a unit test asserting the SQL mentions the configured
    database/table names.
    If NO ClickHouse conversations code exists anymore → delete the script +
    its package.json wiring instead (dead feature), and note that in the PR;
    do NOT invent a new implementation.

### Step 2–5: Path/copy fixes

2. Update the seven patch-wrangler-env citations to
   `apps/dashboard/scripts/patch-wrangler-env.ts`.
3. CONTRIBUTING Node line → "Node.js 22+ (matches `engines`: >=22.22.1)".
4. Fix both ai-agent.mdx paths; also grep
   `rg -l "docs/content/ai-agent" . --glob '!node_modules'` for stragglers.
5. Add an "Ops notifications worker (cloud-hooks)" section/table to
   `docs/content/reference/environment-variables.mdx` listing every var read
   in `apps/cloud-hooks/src/env.ts` with one-line purpose (derive from that
   file only); add matching keys (names only, empty values) to
   `apps/cloud-hooks/.env.example`.

## Done criteria

- [ ] `pnpm run setup:agent-conversations-clickhouse` either works against a local CH or no longer exists (state which)
- [ ] `rg -n "scripts/patch-wrangler-env" docs/knowledge AGENTS.md .claude/skills | grep -v "apps/dashboard"` → no matches
- [ ] CONTRIBUTING/AGENTS fixes applied; env table added
- [ ] lint green; docs build green if touched

## STOP conditions

- Step 1 evidence is ambiguous (partially-existing ClickHouse store) → implement nothing; report findings and options.

## Maintenance notes

- Consider a CI link/path linter for knowledge notes later (idea only).
