# MCP registry submissions (M3)

> Source: 2026-H2 market research, task **M3** in
> [`05-implementation-tasks.md`](./05-implementation-tasks.md) /
> [issue #2390](https://github.com/chmonitor/chmonitor/issues/2390). This doc holds the
> exact payload/text for each external registry — the agent that prepared this does not
> submit to external services, so a maintainer sends these by hand. See
> [`docs/knowledge/mcp-server.md`](../../knowledge/mcp-server.md) for the in-repo half
> (`server.json`, one-command install docs).

**Server identity used everywhere below:**

| Field | Value |
|---|---|
| Name | chmonitor |
| Endpoint | `https://dash.chmonitor.dev/api/mcp` (streamable-http, stateless) |
| Repo | <https://github.com/chmonitor/chmonitor> (source: `apps/mcp` + `packages/mcp-server`) |
| Homepage | <https://chmonitor.dev> |
| Auth | `Authorization: Bearer chm_...` (API key, see [`/operate/authentication/api-keys`](https://docs.chmonitor.dev/operate/authentication/api-keys)) or Clerk OAuth on the hosted instance; self-hosted instances may run open on a trusted network |
| Category | Database / observability / DevOps |
| Tools | `query`, `list_databases`, `list_tables`, `get_table_schema`, `get_metrics`, `get_running_queries`, `get_slow_queries`, `get_merge_status`, `explore_table_schema`, `analyze_performance` (read-only) |

One-line pitch: **"Give your AI agent safe, read-only access to ClickHouse system tables — ask Claude why your query is slow, why parts are piling up, or why replication is lagging."**

---

## 1. Official MCP Registry (registry.modelcontextprotocol.io)

**What's already in-repo:** `server.json` at the repo root, validated against
`https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`
(`name: io.github.chmonitor/chmonitor`, `remotes[0]` = the streamable-http endpoint
above). Nothing to hand-copy — the maintainer publishes that file as-is.

**Publish steps** (from repo root, needs a GitHub account with write access to the
`chmonitor` org — that's what proves the `io.github.chmonitor/*` namespace):

```bash
# 1. Install the CLI
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" \
  | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/

# 2. Authenticate (device flow — opens github.com/login/device)
mcp-publisher login github

# 3. Publish server.json from the repo root
mcp-publisher publish

# 4. Verify
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.chmonitor/chmonitor"
```

**Upkeep:** bump the `version` field in `server.json` and re-run `mcp-publisher publish`
whenever the MCP tool list, auth model, or endpoint URL changes — the registry does not
auto-sync from the repo.

**Optional upgrade:** chmonitor owns `chmonitor.dev`, so the namespace could later move
from `io.github.chmonitor/chmonitor` to a DNS-verified `dev.chmonitor/chmonitor` (add a
`_mcp-registry.chmonitor.dev` TXT record with a challenge token from
`mcp-publisher login dns`). Not required — GitHub auth is sufficient — but a cleaner
long-term name if the maintainer wants it.

**Optional follow-up (not implemented here):** a GitHub Actions job that runs
`mcp-publisher publish` on release, using a registry token stored as a repo secret. See
<https://github.com/modelcontextprotocol/registry> docs ("Publish with GitHub Actions")
if this is worth automating later — skipped in this change since it needs the
maintainer to mint and store that credential first.

---

## 2. PulseMCP (pulsemcp.com)

**Submit at:** <https://www.pulsemcp.com/submit>

The form's only required field is a **URL** ("Can be a GitHub repository, a subfolder of
a repository, or a standalone website"). Submit type: **MCP Server** (there's a toggle
for Server vs. Client).

**URL to submit:** `https://github.com/chmonitor/chmonitor/tree/main/apps/mcp`

If the form expands to ask for more (PulseMCP has iterated on this form; re-check before
submitting), use:

- **Name:** chmonitor
- **Description:** Read-only MCP server for ClickHouse monitoring — query schema, slow
  queries, merges, replication, and cluster health. Part of chmonitor, an open-source
  operational advisor for ClickHouse (recommends projections, skip indexes, partition
  keys, and materialized views from `system.*`, never auto-applies DDL).
- **Repo:** <https://github.com/chmonitor/chmonitor>
- **Website:** <https://chmonitor.dev>
- **Category:** Databases / DevOps / Observability

PulseMCP's homepage also states they now work directly with partners for curated,
quality-controlled listings (contact `hello@pulsemcp.com`) — worth a follow-up email if
the self-serve form is slow to process.

---

## 3. cursor.directory

**Submit at:** <https://cursor.directory/mcp> (look for the "Submit" affordance on the
MCP section; cursor.directory is community-run and has changed its submission UI more
than once, so verify the current flow before sending — no stable public API or GitHub PR
process was found as of this writing).

**Payload to paste into whatever form is live:**

- **Name:** chmonitor
- **Tagline:** ClickHouse monitoring and query diagnostics for your AI agent
- **Description:** Connects Cursor to a ClickHouse cluster through chmonitor's MCP
  server. Query schema, inspect running/slow queries, check merge and replication
  health, and get read-only answers about why a query is slow or why parts are piling
  up — without giving the agent direct database credentials.
- **Config snippet** (what cursor.directory typically shows users to add to
  `.cursor/mcp.json`):

  ```json
  {
    "mcpServers": {
      "clickhouse-monitor": {
        "url": "https://dash.chmonitor.dev/api/mcp",
        "headers": { "Authorization": "Bearer chm_your_api_key" }
      }
    }
  }
  ```

- **Repo:** <https://github.com/chmonitor/chmonitor>
- **Category:** Database / DevOps

---

## 4. Smithery (smithery.ai)

Smithery's primary flow is "connect a GitHub repo, Smithery builds/hosts it" (via a
`smithery.yaml` describing a `build` + `startCommand`) — that model doesn't fit
chmonitor, which already runs as a long-lived remote HTTP server operators self-host or
use at `dash.chmonitor.dev`. **Do not add a `smithery.yaml`** that tells Smithery to
build/run the server; that would be misleading (Smithery would try to containerize and
host a copy instead of pointing at the real, already-running endpoint).

**Submit instead as an externally-hosted remote server:**

1. Go to <https://smithery.ai> → sign in → "Add Server" / "New" (their new-server
   flow currently starts from a GitHub repo URL; if it insists on a build config,
   choose the "remote / already deployed" option rather than "build from source" — this
   has moved around Smithery's UI, re-check at submission time).
2. Point it at: <https://github.com/chmonitor/chmonitor> (repo), remote endpoint
   `https://dash.chmonitor.dev/api/mcp`.
3. Fields to fill:
   - **Name:** chmonitor
   - **Description:** (same as PulseMCP above)
   - **Transport:** Streamable HTTP
   - **Auth:** Bearer token (API key) — mark as required; mention Clerk OAuth is also
     accepted on the hosted instance
   - **Tools:** the 10-tool list in the table above (`query`, `list_databases`, …)

If Smithery's flow strictly requires a `smithery.yaml` even for remote servers, a
minimal one (not added to the repo by this change — add only if Smithery's own docs
confirm this shape at submission time) would look like:

```yaml
# smithery.yaml — NOT committed; reference only, verify against
# https://smithery.ai/docs/build before adding to the repo.
runtime: "remote"
remote:
  url: "https://dash.chmonitor.dev/api/mcp"
  transport: "streamable-http"
  headers:
    Authorization:
      description: "Bearer chm_ API key or Clerk OAuth token"
      required: true
```

---

## 5. Glama (glama.ai)

Glama indexes servers directly from a GitHub repo — no form fields beyond the repo URL
are documented; it crawls the README, tool schemas, and annotations.

**Submit at:** <https://glama.ai/mcp/servers> (look for "Add server" / "Submit"; as with
the others, verify the current entry point before sending).

**URL to submit:** `https://github.com/chmonitor/chmonitor`

Glama's quality bar favors "a real README with an install guide" over a bare git URL —
the repo README's MCP Server section (one-command `claude mcp add` + Cursor JSON
snippet, added in this change) and
[`docs/content/reference/mcp-server.mdx`](../../content/reference/mcp-server.mdx) /
[`mcp-clients.mdx`](../../content/reference/mcp-clients.mdx) should satisfy that. If
Glama's submission form asks for fields explicitly:

- **Name:** chmonitor
- **Repository:** <https://github.com/chmonitor/chmonitor>
- **Installation snippet:** the `claude mcp add --transport http clickhouse-monitor
  https://dash.chmonitor.dev/api/mcp --header "Authorization: Bearer chm_..."`
  one-liner from the README
- **Transport:** Streamable HTTP
- **Tool count:** 10
- **One-line capability summary:** (same one-line pitch as the top of this doc)

Glama also supports multiple listed servers per domain if a repo exposes more than one —
not applicable here since `apps/mcp` is the single MCP endpoint for the whole product.

---

## Not in scope for this task

- **awesome-clickhouse PR** and **README-as-landing-page** polish are task **M4**
  ([`05-implementation-tasks.md`](./05-implementation-tasks.md)), already prepared
  separately in
  [`awesome-clickhouse-submission.md`](./awesome-clickhouse-submission.md).
- **GitHub Actions auto-publish** to the official registry on release — flagged as a
  follow-up above, not implemented (needs a registry token secret the maintainer must
  mint first).
