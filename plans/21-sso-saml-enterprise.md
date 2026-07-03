# 21 — SSO / SAML for Enterprise

## Kickoff prompt

```text
Execute plans/21-sso-saml-enterprise.md ALONE (Wave E, Enterprise, Depth E — do light
discovery first). Add SAML/OIDC SSO for enterprise orgs, preferring Clerk enterprise
connections, with domain-verified JIT org+user provisioning.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE; every auth/plan gate FAILS OPEN without Clerk (no Clerk →
  SSO code path is inert, normal login unaffected).
- SSO is an ENTERPRISE-edition feature: gate via lib/edition; it must NOT degrade or remove
  any capability for the OSS/community edition.
- AI recommends DDL, never auto-applies (not touched here, keep it true).
- Postgres = NO. Identity/domain mapping persists in D1 only.

Resolve the OPEN QUESTIONS in this file before writing app code. End by running the
Verification commands and pasting results.
```

## Current reality (audited)

- **Why (spec 21):** SSO/SAML is table-stakes for enterprise deals. `edition` *flags* an
  enterprise tier but **nothing enforces or provisions SSO** — there is no SAML metadata
  handling, no assertion validation, no JIT provisioning.
- Edition gating exists: `apps/dashboard/src/lib/edition/edition.ts` (+ `index.ts`,
  `edition.test.ts`) defines the enterprise-feature surface (`ENTERPRISE_FEATURES` per the
  Round-2 audit). No `sso` capability is wired to it yet.
- Auth is Clerk-based; billing owner / org resolution lives under
  `apps/dashboard/src/lib/billing/` (`user-subscription.ts`, `org-host-count.ts`) and the
  Clerk webhook at `apps/dashboard/src/routes/api/v1/webhooks/clerk.ts`.
- No `apps/dashboard/src/lib/auth/sso/` directory exists yet.

## Goal

Enterprise admins configure an IdP (SAML or OIDC) for a **verified domain**; a user logging
in via that IdP is **JIT-provisioned** into the correct Clerk org + chmonitor user, their
session resolves to the **Enterprise** edition/plan, and IdP group claims map to roles
(handoff to plan 23 RBAC). Community/self-hosted logs in exactly as today.

## Implement now

> Depth **E**: settle the open questions, then build. Prefer **Clerk enterprise
> connections** over hand-rolling SAML XML validation — Clerk already handles metadata,
> signature validation, and the ACS endpoint, which removes the highest-risk crypto code.

**Approach & key files**
- New `apps/dashboard/src/lib/auth/sso/` — thin module: IdP-connection config resolution,
  verified-domain lookup, and JIT provisioning orchestration. If Clerk owns assertion
  validation, this module holds *mapping* logic (domain → org, IdP groups → roles), not XML
  parsing.
- New `apps/dashboard/src/routes/api/v1/auth/sso-callback.ts` — post-auth hook that reads the
  Clerk-verified session, resolves/creates the org for the verified domain, and links the
  user (JIT). `(verify)` whether Clerk's hosted callback removes the need for a custom route;
  if so, this becomes a webhook/`session.created` handler instead.
- `apps/dashboard/src/lib/edition/edition.ts` — add an `sso` enterprise capability and gate
  the config/admin surface on it. Community edition: capability absent → SSO admin hidden,
  normal login untouched.
- Domain-verification + IdP-connection metadata persisted in a new D1 table
  (e.g. `sso_connections`: `org_id`, `domain`, `provider`, `clerk_connection_id`,
  `default_role`, `created_at`) — migration under
  `apps/dashboard/src/db/conversations-migrations/` (next sequential number, `.sql`).
- Group→role mapping is the seam to **plan 23** (`lib/rbac/rbac.ts`): store the claim→role map
  with the connection; on provisioning, set the Clerk org-role so 23's gates read it.

**Fail-open wiring:** every entry point resolves the owner/org via the existing billing-owner
helpers; when Clerk is absent those throw and the call site swallows it (the established OSS
pattern), so the SSO path never runs and normal auth is unaffected.

**Open questions to resolve during discovery (answer in the PR description):**
1. **Clerk capability:** does the project's Clerk plan expose SAML/OIDC *enterprise
   connections* via API, or only dashboard-configured? Determines whether admin config is
   in-app or a documented Clerk-dashboard step. `(verify)`
2. **Domain verification source of truth:** Clerk-verified domains vs. a chmonitor-owned DNS
   TXT check. Prefer Clerk's if available.
3. **JIT org strategy:** one Clerk org per verified domain, or map to an existing org chosen
   by the admin? Affects the `sso_connections` unique key.
4. **Callback shape:** custom `/auth/sso-callback` route vs. `session.created`/`user.created`
   Clerk webhook extension in `webhooks/clerk.ts`. Pick one; don't build both.
5. **Group→role claim path:** exact claim name per provider (Okta/Azure AD/Google) — record
   the mapping table shape for plan 23.

## STOP conditions & drift check

- **STOP** if implementing SAML assertion signature validation *by hand* becomes necessary
  (Clerk not viable) — that is a security-critical scope change; surface it and get a decision
  before writing XML/crypto code.
- **STOP** if any change would gate a currently-free capability for community/self-hosted, or
  make normal (non-SSO) login depend on Clerk being present.
- **Drift check:** if `edition.ts` no longer exposes an enterprise-feature registry, or Clerk
  is no longer the auth provider, STOP and reconcile with the current code before proceeding.
- Do not touch AI/DDL paths; do not add Postgres.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/auth/sso --isolate
cd apps/dashboard && bun test src/lib/edition/edition.test.ts --isolate
cd apps/dashboard && bun run lint
```

## Done criteria

- [ ] `sso` is a named enterprise capability in `lib/edition`; disabled outside enterprise
  edition (asserted by a test).
- [ ] A verified-domain SSO login **JIT-provisions** a Clerk user + org and the session
  resolves to Enterprise (integration-style test with Clerk mocked).
- [ ] IdP group claims map to a role stored for plan 23 to consume (unit test on the mapping).
- [ ] Community/self-hosted (no Clerk) login path is unchanged and SSO code is inert
  (fail-open test).
- [ ] D1 migration for `sso_connections` committed; no Postgres introduced.
- [ ] All five open questions answered in the PR description.
- [ ] type-check, build, targeted tests, lint all green.

---

Priority P2 · Effort L · Depth E · Wave E (Enterprise) · Lever Enterprise/Revenue
