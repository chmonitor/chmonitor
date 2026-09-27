---
id: commercial-license
title: Self-hosted commercial licenses (honor system)
type: spec
status: active
updated: 2026-09-27
tags:
  - billing
  - license
  - pricing
  - sponsor
  - landing
  - telemetry
related:
  - billing-checkout-flow
  - cloud-saas-mode
---

# Self-hosted commercial licenses

**Primary paid product** is a host-based license for teams that already
self-host [REDACTED]. Hosted Polar SaaS stays as a convenience path only.

## Decision

- Community OSS stays GPL-3.0, unlimited, no DRM. Missing `CHM_LICENSE_KEY`
  is a normal community install — do **not** gate features or fail-closed.
- Paid SKUs live in `packages/pricing/src/licenses.ts` (not `plans.ts`).
- Yearly and lifetime on Team and Unlimited. Personal is $0.
- Buy + register: company name + website; listing on `/customers` is opt-in.
- Trust model: Polar checkout on **cloud-hooks**
  (`GET https://hooks.chmonitor.dev/checkout/license?sku=&term=`), optional
  `email`/`company`/`website` query params (customer_email + metadata).
  Polar emails the **receipt**. We do not mint a dedicated key and do not
  send a license-key email.
  Polar `success_url` **must** include `{CHECKOUT_ID}`. Dash URL 302s to hooks.
  Lookup: `GET /licenses/lookup?q=` (checkout id or billing email).
  Register persist: `POST /licenses/register`. User-facing how-to:
  `docs/content/operate/advanced/commercial-license.mdx`.
- **`CHM_LICENSE_KEY` is the Polar checkout id** from the receipt — the same
  identifier lookup already accepts. Cloud-hooks does not issue a second
  format. Operators set it on the dashboard process (Docker / Helm / Worker).
  When telemetry is on, the instance ping includes `license_key`; when
  telemetry is off, nothing is sent. Do not add a Settings license field.

## SKUs (USD)

| id | hosts | yearly | lifetime |
|---|---|---|---|
| personal | ∞ | 0 | 0 |
| team | 3 | 499 | 1349 |
| unlimited | ∞ | 999 | 2999 |

Do not silently change these without updating landing `/pricing`, docs
`operate/advanced/commercial-license`, and README.

## Why these numbers

Self-host infra teams will not pay $29–99/mo to *us* to host a dashboard they
can run in Docker. They will pay a commercial license for invoice / support /
“we sponsor the project”. Launch ladder sits below Cloud Pro ($290/yr) and far
below pganalyze / Datadog. Three SKUs only: Personal (free self-host), Team
$499 / $1,349 (3 hosts), Unlimited $999 / $2,999.

## Sponsorship (separate from licensing)

One-off tiers in `packages/pricing/src/sponsors.ts`: **supporter $59** (name +
website on `/sponsors`), **backer $99** (+ logo under the homepage hero),
**partner $199** (larger hero slot, optional note). Not a license: no features,
no support window, no key. Checkout reuses the Polar pay-what-you-want product
(`GET /checkout/donate?amount=`, `CHM_POLAR_DONATE_PRODUCT`) — the wire name is
legacy, the surface is Sponsor. The listing is a **committed seed**
(`apps/landing/src/data/sponsors.ts`, empty until the first confirmed sponsor)
because the landing site is static; `POST /sponsors/register` records the
request in `CHM_HOOKS_KV`. Publish the **name and website link only** — the
email stays in KV. With no sponsor, the hero slot and `/sponsors` render the
open-slot design; that empty state is intentional, not a gap.

## Surfaces

- Landing cards: `apps/landing/src/components/Pricing.astro`
- Register: `apps/landing/src/pages/license/register.astro` (paid=1 POSTs to hooks)
- Lookup: `apps/landing/src/pages/license/lookup.astro`
- Wall: `apps/landing/src/pages/customers.astro`
- Sponsor tiers + claim form: `apps/landing/src/pages/license.astro#sponsor`,
  `apps/landing/src/pages/sponsors.astro`
- Hero sponsor slot: `apps/landing/src/components/SponsorSlot.astro` (in
  `Hero.astro`, below the feature list)
- User docs: `docs/content/operate/advanced/commercial-license.mdx`
- Dashboard env: `CHM_LICENSE_KEY` (Polar checkout id) → instance ping
  `license_key` when telemetry is on (`lib/telemetry/instance-ping.ts`)
- Cloud Polar checkout is hooks/landing only: [billing-checkout-flow](billing-checkout-flow.md)

## Do not

- Add license-key enforcement or fail-closed edition checks for paying.
- Add Polar checkout or plan picker back into `apps/dashboard`.
- Add a Settings / UI field for the key.
- Auto-list a company without `listPublic: true`.
- Auto-list a sponsor without a confirmed row in
  `apps/landing/src/data/sponsors.ts`, or publish a sponsor's email address.
- Rename `CHM_POLAR_DONATE_PRODUCT` in a rename-only PR — the live product id is
  committed; 501 the sponsor checkout until a `polar-setup.ts` run lands.
