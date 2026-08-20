---
id: install-sh-bot-fight
title: CLI install.sh and Cloudflare Bot Fight Mode
type: reference
status: active
updated: 2026-08-20
tags:
  - cli
  - cloudflare
  - bot-fight-mode
  - install
related:
  - standalone-cli
  - deployment
---

# CLI `install.sh` and Cloudflare Bot Fight Mode

## Symptom

```bash
curl -sSf https://chmonitor.dev/install.sh | bash
# curl: (22) The requested URL returned error: 403
```

Response headers include `cf-mitigated: challenge` and an HTML "Just a moment…"
body. Browsers with full Client Hints still get `200` + the shell script.

## Cause

Cloudflare **Bot Fight Mode** (Free plan) challenges known automated clients
(including curl's TLS fingerprint). It runs **outside** the Ruleset Engine, so
WAF custom rules, Configuration Rules, and Page Rules **cannot** skip it for
`/install.sh` alone. Official docs: turn BFM off, or upgrade to Super Bot Fight
Mode / Bot Management and write Skip rules.

## Current installer URL

Documented curl install uses **GitHub raw** (no Cloudflare challenge):

```bash
curl -sSf https://raw.githubusercontent.com/chmonitor/chmonitor/main/scripts/install.sh | bash
```

The landing Worker still copies `scripts/install.sh` → `public/install.sh` so
browsers can open `https://chmonitor.dev/install.sh`.

## Restore the branded curl URL

1. Dashboard → **Security** → **Settings** → filter **Bot traffic** → **Bot
   Fight Mode** → **Off**  
   https://dash.cloudflare.com/?to=/:account/:zone/security/settings  
   Or API: `PUT /zones/:id/bot_management` with `{"fight_mode":false}` (needs
   Zone → Bot Management → Edit on the API token).
2. Run `pnpm run cf:allow-install-sh` (upserts a Config Rule that softens BIC /
   security_level for `/install.sh`, then verifies curl with a curl User-Agent).
3. Switch `CLI_INSTALL` / docs back to `https://chmonitor.dev/install.sh`.

Workflow: run locally or in CI with a token that has Bot Management edit —
`pnpm run cf:allow-install-sh`.

## Token note

The Workers deploy token often has Config Rules but **not** Bot Management.
Expand `CLOUDFLARE_API_TOKEN` (repo secret + local `.env.local`) with
**Zone → Bot Management → Edit** so the script can flip `fight_mode` without a
dashboard click.
