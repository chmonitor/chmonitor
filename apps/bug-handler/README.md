# bug-handler

Cloudflare Email Worker that converts inbound bug-alert emails (e.g. from Sentry)
into GitHub issues automatically.

```
Sentry alert → email → Cloudflare Email Routing → bug-handler worker → GitHub issue
```

Everything is configurable via environment variables — the target address, repository,
labels, assignees, and token are injected at deploy time. Nothing is hardcoded.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | **Yes** (secret) | — | PAT or GitHub App token with `issues:write`. Set via `wrangler secret put`. |
| `GITHUB_REPOSITORY` | **Yes** | `chmonitor/chmonitor` | Target repo in `owner/repo` format. |
| `BUG_HANDLER_TARGET_ADDRESS` | No | accept any | Recipient address the worker accepts (e.g. `bug@chmonitor.dev`). Mail to other addresses is silently ignored. |
| `BUG_ISSUE_LABELS` | No | `bug,sentry,automated` | Comma-separated labels applied to every issue. |
| `BUG_ISSUE_ASSIGNEES` | No | _(none)_ | Comma-separated GitHub usernames to assign. |
| `BUG_ISSUE_TITLE_PREFIX` | No | `[Sentry] ` | Prefix prepended to the issue title. |
| `BUG_ALLOWED_SENDERS` | No | _(allow all)_ | Comma-separated sender addresses or `@domain` rules. When set, mail from unlisted senders is dropped. |
| `GITHUB_API_BASE` | No | `https://api.github.com` | Override for GitHub Enterprise Server or tests. |

## Setup

### 1. Enable Cloudflare Email Routing

In the Cloudflare dashboard for your zone:

1. Go to **Email → Email Routing** and enable it.
2. Add a custom address rule:
   - **Custom address**: `bug@chmonitor.dev`
   - **Action**: Send to Worker
   - **Worker**: `chmonitor-bug-handler`

This wires the email address to this worker. The address itself is not configured
in `wrangler.toml` — Email Workers are invoked by routing rules, not HTTP routes.

### 2. Set the GitHub token secret

```bash
cd apps/bug-handler
wrangler secret put GITHUB_TOKEN
# paste your PAT or GitHub App installation token
```

The token needs `issues:write` on the target repository.

### 3. Deploy

```bash
# Production
pnpm run deploy

# Preview environment
pnpm run deploy:preview
```

Override non-secret vars at deploy time if needed:

```bash
pnpm run deploy --var GITHUB_REPOSITORY:myorg/myrepo --var BUG_ISSUE_LABELS:bug,p1
```

## Preview vs production

| | Production | Preview |
|---|---|---|
| Worker name | `chmonitor-bug-handler` | `preview-chmonitor-bug-handler` |
| Deploy command | `pnpm run deploy` | `pnpm run deploy:preview` |
| Routing rule | Set up on main zone | Set up on preview zone / separate address |

## Development

```bash
pnpm install
pnpm run type-check   # tsc --noEmit
bun test src/        # unit + integration tests
pnpm exec biome check src/
```
