# Plan 85: Fail closed on unknown senders in the bug-handler email worker

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/bug-handler/src`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (stricter default; built-in Sentry default preserves the intended flow)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2502

## Why this matters

The bug-handler Email Worker turns inbound mail (e.g. `bug@chmonitor.dev`) into
GitHub issues. Its sender policy **fails open**: when `BUG_ALLOWED_SENDERS` is
unset (the default), every sender is allowed — so anyone who emails the address
can create issues in the configured repo (issue spam / content injection into
the tracker, which agents then read). SPF validates the sending *domain*, not
authorization. Intended source is Sentry alert mail only (see
`docs/knowledge/bug-handler-email-worker.md`).

## Current state

`apps/bug-handler/src/config.ts:111-115`:

```ts
export function isSenderAllowed(
  address: string,
  allowedSenders: string[]
): boolean {
  if (allowedSenders.length === 0) return true   // ← fail-open default
```

(The matching rules above it — exact / `@domain` / plain-domain with `@`
boundary — are good; keep them.) `parseConfig` in the same file yields `[]`
when `BUG_ALLOWED_SENDERS` is unset. Caller:
`apps/bug-handler/src/index.ts:81-86` (uses SPF-validated `message.from`).
Existing tests: check `apps/bug-handler/src/**/*.test.ts` for the config test
file and extend it.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `cd apps/bug-handler && bun test` | all pass |
| Typecheck | `cd apps/bug-handler && pnpm run build` (or the app's check script — read its package.json scripts) | exit 0 |

## Scope

**In scope**: `apps/bug-handler/src/config.ts` (default policy),
`index.ts` (log-and-drop message for rejected senders), its tests,
`docs/knowledge/bug-handler-email-worker.md` (document the new default).

**Out of scope**: GitHub issue formatting; the Sentry parsing; dashboard app.

## Git workflow

- Branch: `advisor/85-bug-handler-fail-closed-senders`
- Commit: `fix(bug-handler): default sender policy to Sentry-only, fail closed`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Change the default
When `BUG_ALLOWED_SENDERS` is unset, default `allowedSenders` to a built-in
Sentry sender list (`['@sentry.io', '@notifications.sentry.io']` — verify
actual Sentry alert sender domains from an existing parsed sample in the repo
fixtures/tests if present). Empty-after-explicit-set (`BUG_ALLOWED_SENDERS=""`)
should mean "reject all", not "allow all". Add an explicit opt-out value
(`BUG_ALLOWED_SENDERS=*` → allow all) for operators who genuinely want open
intake.
**Verify**: `bun test` — extend the config tests: unset → Sentry default;
`""` → rejects everything; `*` → allows; explicit list unchanged.

### Step 2: Log dropped mail
In `index.ts`, when a sender is rejected, log sender + subject at warn level
before dropping (operators need to notice misconfiguration).
**Verify**: test asserting the drop path doesn't call the GitHub client and logs.

### Step 3: Update the knowledge doc
`docs/knowledge/bug-handler-email-worker.md`: document the default, `""`, and
`*` semantics; bump its `updated:` frontmatter date.
**Verify**: doc contains the three cases.

## Done criteria

- [ ] Unset env → Sentry-only; `""` → reject-all; `*` → allow-all (all tested)
- [ ] Rejected senders logged, no issue created
- [ ] Knowledge doc updated; `plans/README.md` updated

## STOP conditions

- Production currently relies on non-Sentry senders (check the deployed env:
  if `BUG_ALLOWED_SENDERS` is unset AND the issue tracker shows issues from
  other senders, the default change would drop real mail) — report first.

## Maintenance notes

- If Sentry changes its sender domain, alert mail silently stops creating
  issues — the warn log from Step 2 is the operator's signal; mention it in the
  doc.
