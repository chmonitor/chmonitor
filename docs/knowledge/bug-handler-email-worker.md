---
id: bug-handler-email-worker
type: spec
related: [observability-sentry, deployment, cluster-topology]
tags: [bug-handler, email, cloudflare, github-issues, sentry, automation]
updated: 2026-07-10
---

# Bug-handler email worker (email → GitHub issue)

`apps/bug-handler` is a standalone **Cloudflare Email Worker** that turns inbound
bug-alert emails (Sentry sends them to a configured address such as
`bug@chmonitor.dev`) into well-formatted **GitHub issues** an automated coding
agent can pick up.

```
Sentry alert → email → Cloudflare Email Routing → bug-handler worker → GitHub issue
```

Built like `apps/telemetry`: own `pnpm-lock.yaml` (not in the root workspace), own
`wrangler.toml` with a `[env.preview]`, deployed by its own job in
`.github/workflows/cloudflare.yml`.

## Nothing hardcoded — all config is env

| Var | Where set | Notes |
|-----|-----------|-------|
| `BUG_HANDLER_TARGET_ADDRESS` | CI `--var` from repo **variable** | The inbound address; kept out of the public repo. Unset → accept any recipient. |
| `GITHUB_REPOSITORY` | CI `--var` (`${{ github.repository }}`) | `owner/repo` issues are filed in. |
| `GITHUB_TOKEN` | `wrangler secret put` from `BUG_HANDLER_GITHUB_TOKEN` secret | PAT/App token with `issues:write`. |
| `BUG_ISSUE_LABELS` | `wrangler.toml` `[vars]` default | e.g. `bug,sentry,automated`. |
| `BUG_ISSUE_ASSIGNEES` | CI `--var` from repo **variable** | Auto-assign a bot/user, e.g. `duyetbot`. |
| `BUG_ISSUE_TITLE_PREFIX` | `wrangler.toml` `[vars]` default | e.g. `[Sentry] `. |
| `BUG_ALLOWED_SENDERS` | optional | Allowlist of senders/domains; **fails closed**. Matched against the **SMTP envelope sender** (`message.from`), not the spoofable MIME `From:`. |

### `BUG_ALLOWED_SENDERS` semantics (fail closed)

The worker exists to turn Sentry alert mail into GitHub issues, so an unset
allowlist must NOT mean "accept anyone" — that would let any sender open
issues in the configured repo. `parseConfig` resolves `BUG_ALLOWED_SENDERS` to
one of:

| Value | Resolves to | Effect |
|-------|-------------|--------|
| unset (not in env at all) | built-in default `['@sentry.io', '@notifications.sentry.io']` | Sentry-only, fail closed |
| `""` (explicitly set to empty) | `[]` | rejects every sender |
| `"*"` | `['*']` | explicit opt-out — allows every sender |
| `"a@b.com,@c.com"` | parsed comma list | unchanged allowlist behavior |

Rejected senders are logged at `console.warn` with the sender address and
subject before the message is dropped (no issue created, no GitHub API call).
If Sentry ever changes its alert-sending domain, mail from it starts being
silently rejected — that warn log is the operator's only signal, so alert on
it (or watch Worker logs) rather than assuming silence means no bug reports.

## Pipeline (`src/`)

- `config.ts` — `parseConfig(env)` → typed config; `isSenderAllowed()`.
- `parse-email.ts` — `parseEmail()` via `postal-mime`; `extractSentryMeta()`
  best-effort pulls Sentry issue URL / level / project / environment / culprit.
- `github-issue.ts` — `buildIssue()` (agent-friendly markdown: Summary, Source
  table, Details, **For the coding agent** checklist) + `createGitHubIssue()`
  (REST `POST /repos/{owner}/{repo}/issues`, never throws).
- `index.ts` — the `email()` handler: recipient guard → parse → sender allowlist
  → misconfig guards → build → `ctx.waitUntil(createGitHubIssue(...))`. Wrapped
  so it never surfaces an unhandled rejection.

## One-time Cloudflare setup (dashboard, not wrangler)

Email Routing on the zone → custom address (e.g. `bug@chmonitor.dev`) →
**Send to Worker** → `chmonitor-bug-handler`. Then set the
`BUG_HANDLER_GITHUB_TOKEN` and `BUG_HANDLER_TARGET_ADDRESS` /
`BUG_HANDLER_ASSIGNEES` repo secret/variables so CI injects them.

## Tests

`bun test src/` — 91 tests across config / parse-email / github-issue / index
(the last is an integration test that drives the real `email()` handler with a
fake `ForwardableEmailMessage` and a stubbed `fetch`).
