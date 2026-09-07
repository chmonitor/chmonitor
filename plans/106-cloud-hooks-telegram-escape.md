# Plan 106: Escape user-controlled fields in cloud-hooks Telegram HTML

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/cloud-hooks/src/polar-notify.ts apps/cloud-hooks/src/exceptions.ts apps/cloud-hooks/src/clerk-webhook.ts`
> On mismatch, re-read live files; the excerpts below must match before editing.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3302

## Why this matters

cloud-hooks sends operator notifications over Telegram with
`parse_mode: 'HTML'` (`apps/cloud-hooks/src/telegram.ts:139`). Two send paths
interpolate externally-influenced text into that HTML without escaping:

1. `formatCheckoutStarted` (`polar-notify.ts:158–170`) interpolates `company`,
   `email`, `website`, `checkoutId`, `checkoutUrl` — values that originate from
   anonymous query params on the public `GET /checkout/license` endpoint
   (`license-checkout.ts:71–73`) and travel through Polar checkout metadata.
2. The exception notifier (`exceptions.ts:412–417`) embeds raw
   `exc.message`/`exc.script` (Cloudflare telemetry, request-influenced error
   text).

Markup-significant input breaks Telegram's parser → the notification is
**rejected and lost** (a dropped sales/incident signal), or renders as
attacker-chosen formatting in the ops channel. Sibling modules already solve
this: `clerk-webhook.ts:154` and `issues.ts:195` both define an identical local
`escapeHtml`.

## Current state

`apps/cloud-hooks/src/polar-notify.ts:157–170`:

```ts
/** Telegram HTML for a Polar license checkout that just opened (not paid yet). */
export function formatCheckoutStarted(input: CheckoutStartedInput): string {
  const lines = [
    '\u{1F6D2} <b>License checkout started</b>',
    `sku: <b>${input.sku}</b> · ${input.term}`,
  ]
  if (input.company) lines.push(`company: ${input.company}`)
  if (input.email) lines.push(`email: <code>${input.email}</code>`)
  if (input.website) lines.push(`site: ${input.website}`)
  if (input.checkoutId) lines.push(`checkout: <code>${input.checkoutId}</code>`)
  if (input.checkoutUrl) lines.push(input.checkoutUrl)
```

`sku`/`term` are allowlisted upstream (`isPaidSku`/`isLicenseTerm`) so they are
safe as-is; the five optional fields are not.

`apps/cloud-hooks/src/clerk-webhook.ts:154–156`:

```ts
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '>')
}
```

(Note: the live line ends `.replace(/>/g, '&gt;')` — reproduce it exactly.)

Also unescaped: `exceptions.ts` notification at ~line 415:
`` `\u{1F41B} <b>New Worker exception</b> in <code>${exc.script}</code>\n${exc.message}...` ``

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Tests | `cd apps/cloud-hooks && pnpm install --frozen-lockfile && bun test src/polar-notify.test.ts src/exceptions.test.ts --isolate` | all pass |
| Typecheck | `cd apps/cloud-hooks && pnpm run type-check` | exit 0 |
| Full suite | `cd apps/cloud-hooks && bun test src/ --isolate` | all pass |

## Scope

**In scope**:
- `apps/cloud-hooks/src/polar-notify.ts` (escape the five fields)
- `apps/cloud-hooks/src/exceptions.ts` (escape message/script/url interpolations)
- `apps/cloud-hooks/src/lib/html.ts` (create — shared escapeHtml)
- `apps/cloud-hooks/src/polar-notify.test.ts`, `exceptions.test.ts` (extend)

**Out of scope**:
- Refactoring clerk-webhook/issues to use the new shared module (fine to note,
  but don't churn tested code beyond scope).
- Changing any message copy/formatting beyond wrapping values in escape calls.
- Any change to `telegram.ts` send logic.

## Git workflow

- Branch: `advisor/106-cloud-hooks-telegram-escape`
- Commit: `fix(cloud-hooks): escape user-controlled fields in Telegram HTML` + Co-Authored-By trailer.

## Steps

### Step 1: Create shared escaper

Create `apps/cloud-hooks/src/lib/html.ts`:

```ts
/**
 * Minimal Telegram-HTML text escaping. Values interpolated into messages sent
 * with parse_mode:'HTML' must pass through here — markup-significant input
 * otherwise breaks parsing (message rejected → notification lost) or lets a
 * sender control formatting in the ops channel.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
```

### Step 2: Apply in polar-notify.ts

Import `escapeHtml`; wrap each of: `input.company`, `input.email`,
`input.website`, `input.checkoutId`, `input.checkoutUrl` in the template
literals. Do NOT touch sku/term lines or the static strings.

### Step 3: Apply in exceptions.ts

Wrap `${exc.message}`, `${exc.script}` (and any other dynamic interpolation in
the two notify templates — check `formatSpike` around lines 69–79) with
`escapeHtml(...)`. GitHub-issue body construction in the same file uses fenced
code blocks and needs no change.

### Step 4: Extend tests

In `polar-notify.test.ts`: add cases feeding `<b>x</b>` / `a&b` /
`<script>` into company/email/website/checkoutId/checkoutUrl asserting the
rendered output contains `&lt;b&gt;x&lt;/b&gt;` etc., plus one case asserting
legit URLs survive unchanged except `&`→`&amp;`. Mirror the existing test
style. Add equivalent assertions for exceptions formatting.

## Test plan

Covered in Step 4. Verify with the Commands table. Structural pattern: existing
`polar-notify.test.ts` describe blocks.

## Done criteria

- [ ] `grep -n 'company: \$\|email: <code>\${\|site: \$\|checkout: <code>\${' apps/cloud-hooks/src/polar-notify.ts` shows every interpolation wrapped in escapeHtml(
- [ ] New tests pass; full suite passes
- [ ] `pnpm run type-check` exit 0
- [ ] No files outside in-scope list modified

## STOP conditions

- Existing tests assert exact rendered strings containing raw `<` from fixture inputs (would now fail by design) → update ONLY those fixtures to expect escaped output and note it; if more than trivial, STOP.
- The module structure doesn't match the excerpts → STOP.

## Maintenance notes

- Convention going forward: ANY new field interpolated into a Telegram HTML
  message goes through `lib/html.ts#escapeHtml`. Reviewers should enforce.
- If Telegram messages later move to MarkdownV2 or plain text, revisit.
