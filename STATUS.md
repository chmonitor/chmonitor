# STATUS — feat/dashboard-no-billing

Dashboard no longer sells Polar plans. Money path is landing + `apps/cloud-hooks`.

## Changed

- Removed `/billing` page, sidebar Billing item, plan badges, Polar checkout CTAs, paywall host/modal.
- Removed dashboard APIs: `checkout`, `license-checkout`, `portal`, `subscription`, `can-downgrade`.
- Kept `GET /api/v1/billing/usage` (guest + signed-in AI quota chip) and guest-ai / entitlements (fail-open).
- Removed `CHM_POLAR_*` from dashboard `.env.production` / `.env.example` / `.env.preview`.
- Moved Polar license product IDs to `apps/cloud-hooks/.env.production`.
- `polar-setup.ts` writes hooks env, not dashboard env.
- Docs/skills: billing-checkout-flow, cloud-saas-mode, commercial-license, cloud-hooks-worker, cloud-signup, feature-permissions, CLAUDE.md.

## Left on purpose (follow-up)

- Dashboard `/api/v1/webhooks/polar` still exists as a thin adapter until Polar endpoint cutover to hooks (plans/103). No product UUIDs in dashboard env; secrets only.
- `lib/billing/*` Polar client + subscription store still used by webhook + fail-open plan resolution.
- `use-billing.ts` / `paywall-store.ts` were deleted with the orphaned billing UI (plan 112 / #3307).

## Tests

- `bun test src/lib/billing/guest-ai.test.ts` + first-run-decision: pass.
- `bun test scripts/deploy-worker.test.ts`: pass (hooks overlay finds Polar IDs).
- Some dashboard tests need `apps/dashboard/node_modules` (`@tanstack/react-router`); not run as full monorepo build.

## Operators

- Set Polar product IDs and `POLAR_*` secrets on **cloud-hooks**, not dashboard.
- Landing Buy already points at `hooks.chmonitor.dev/checkout/license`.
