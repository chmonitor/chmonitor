# Plan 107: Verify license-wall registrations against Polar and trim the lookup response

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/cloud-hooks/src/license-register.ts apps/cloud-hooks/src/license-lookup.ts apps/cloud-hooks/src/license-http.ts`
> On mismatch, re-read live files before editing.

## Status

- **Priority**: P1 (SECURITY-02) + P2 trim (SECURITY-03) — combined, same modules.
- **Effort**: M
- **Risk**: LOW–MED (adding server-side verification; failures degrade to private rows by design)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3303

## Why this matters

Two public endpoints on the money-path worker over-share:

1. **`POST /licenses/register`** (`license-register.ts:154–170`): a registration
   reaches the public customers wall when the body merely *contains* any
   `checkout_id` string (≤80 chars). The comment says "Public wall only after
   Polar proof" but no Polar verification happens. Anyone can fabricate wall
   entries impersonating brands on chmonitor.dev, or fill the 500-row cap so
   legit opt-ins get locked out. KV writes are also unthrottled.
2. **`GET /licenses/lookup?q=`** (`license-lookup.ts:92–108`): an email-shaped
   query returns `found: true`, the customer's full email, and paid/sku/term
   with no auth and no rate limit; non-email queries issue up to five Polar API
   calls per request using the shared `POLAR_ACCESS_TOKEN`. The module docblock
   calls it an "honor-system order check" — but echoing the email back makes it
   an enumeration oracle for personal data, beyond that intent.

Fixes: verify checkout IDs against Polar before publishing to the wall;
return only `{found, paid, sku, term}` from lookup; add durable per-IP rate
limits to both.

## Current state

`license-register.ts:145–170` (excerpt):

```ts
const row: LicenseRegistration = {
  id: deps.uuid?.() ?? crypto.randomUUID(),
  ...
}
const checkoutId = clean(rec.checkout_id, 80)
if (checkoutId) row.checkout_id = checkoutId
...
try {
  await kv.put(`${LICENSE_REG_KEY_PREFIX}${row.id}`, JSON.stringify(row))
  // Public wall only after Polar proof (checkout_id). Intent rows stay private.
  if (row.list_public && checkoutId) {
    const index = await readPublicIndex(kv)
    if (index.length < PUBLIC_CAP) {
      index.push(toPublic(row))
      ...
```

`license-lookup.ts:56–70` builds `customerPayload` including `email` and
`status`; line 92: `const looksLikeEmail = q.includes('@')` branches straight
into an unauthenticated Polar customer search.

Rate limiting exists elsewhere in the repo:
`apps/dashboard/src/lib/api/rate-limiter.ts` (`checkRateLimitDurable`) — but
cloud-hooks is a separate worker without that import path. The dashboard's
browser-connections sessions route uses a Cloudflare RATE_LIMIT binding
(`RATE_LIMIT_BINDING_BROWSER_CONN`). Check `apps/cloud-hooks/wrangler.toml` /
`deploy.config.ts`: if no rate-limit binding is configured there, implement a
KV-backed fixed-window limiter locally (see Step 3) instead of inventing new
infrastructure bindings — KV is already bound as `CHM_HOOKS_KV`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Suite | `cd apps/cloud-hooks && bun test src/license-register.test.ts src/license-lookup.test.ts src/license-http.test.ts --isolate` | pass |
| Full | `cd apps/cloud-hooks && bun test src/ --isolate` | pass |
| Typecheck | `cd apps/cloud-hooks && pnpm run type-check` | exit 0 |

## Scope

**In scope**:
- `apps/cloud-hooks/src/license-register.ts`, `license-lookup.ts`
- `apps/cloud-hooks/src/license-http.ts` (only if adding a small shared helper)
- Their test files

**Out of scope**:
- `webhook.ts`, `billing-deps.ts`, anything Telegram
- The dashboard's `/api/v1/webhooks/polar` adapter
- New wrangler bindings/rate-limit products (use KV)

## Git workflow

- Branch: `advisor/107-license-endpoints-verification`
- Commit: `fix(cloud-hooks): verify license-wall checkouts and trim lookup response` + Co-Authored-By.

## Steps

### Step 1: Verify checkout_id before wall publication (register)

In `handleLicenseRegister`, when `row.list_public && checkoutId` is about to
publish: call Polar first via the existing `polarFetch(env, '/v1/checkouts/' +
encodeURIComponent(checkoutId), { method: 'GET' })`. Accept only when
`rec.status === 'succeeded' || rec.status === 'confirmed'` AND
`metaSkuTerm(rec.metadata)` matches the row's sku/term (reuse the exact logic
from `license-lookup.ts:34–47` — hoist those two tiny helpers into
`license-http.ts` and import from both files rather than duplicating).
Verification failure → keep the row private (still stored), skip index push.
Polar fetch throwing → treat as failure-to-verify (stay private), log one line.

Note: `handleLicenseRegister(request, env, deps)` already receives `env`, so
`polarFetch` is available; extend `deps` with optional `fetchImpl` for tests.

### Step 2: Trim the lookup response

Change `customerPayload` to return `{ found: true, source, paid, sku, term }`
— drop `email` and raw `status` fields. Update the checkout branch
(`license-lookup.ts:118–141`) identically (it builds its own object including
`email`/`status`). Keep HTTP codes unchanged. Update the module docblock:
honor-system = existence/paid-state check, not data retrieval.

### Step 3: KV rate limiter for both endpoints

Add to `license-http.ts`:

```ts
/** Fixed-window limiter backed by CHM_HOOKS_KV. Returns false when over limit. */
export async function kvRateLimit(
  kv: LicenseKV | null,
  bucket: string,
  ip: string,
  limit: number,
  windowSeconds: number,
  nowMs: number = Date.now()
): Promise<boolean>
```

Implementation: key `${bucket}:${ip}:${Math.floor(nowMs/(windowSeconds*1000))}`,
read counter (JSON `{n}`), `n >= limit` → false, else put `{n:n+1}` and true.
Missing kv → allow (degrade open, consistent with worker style). Call sites:
register → `kvRateLimit(kv, 'lic-reg', ip, 10, 3600)`; lookup →
`kvRateLimit(kv, 'lic-lookup', ip, 20, 3600)`. Derive IP from
`request.headers.get('cf-connecting-ip') ?? 'unknown'`.

### Step 4: Tests

- register: valid+paid mocked Polar response publishes; unpaid/mismatched/throwing stays private (index unchanged); limiter blocks 11th call/hour (inject `nowMs`).
- lookup: response objects no longer contain `email` or `status` keys (assert key sets); limiter works.
Pattern: existing `license-checkout.test.ts` stub-env/mock-fetch style.

## Test plan

As Step 4; all existing tests must still pass (some may assert the old
response shape — update them minimally).

## Done criteria

- [ ] `rg -n "list_public && checkoutId" apps/cloud-hooks/src/license-register.ts` shows the publish branch preceded by Polar verification code
- [ ] `rg -n "email" apps/cloud-hooks/src/license-lookup.ts` shows no email in any returned payload construction
- [ ] Both endpoints enforce their limiters (tests prove)
- [ ] Full cloud-hooks suite + typecheck green

## STOP conditions

- Existing tests reveal a consumer depending on lookup's `email` field (i.e., internal caller) → STOP and report instead of breaking it.
- `polarFetch` signature/env access differs from the excerpt → re-read and adapt within scope, else STOP.
- Adding verification breaks the documented honor-system flow for REAL buyers in an obvious way (e.g., metadata missing on legacy checkouts) → report; maintainer decides fallback policy.

## Maintenance notes

- If Polar later adds webhook-driven confirmation, the wall could move to
  webhook-published entries only — cleaner long-term; noted for direction.
- Reviewers: check the metaSkuTerm hoist didn't change lookup behavior.
- Wall cleanup of existing fabricated rows is operator work (KV surgery) — out
  of scope here.
