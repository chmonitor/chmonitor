# Dashboard Overview

Overview is the dashboard home: status strip, KPI charts, and tabs (connections, queries, merges, replication, system). It is a **secondary** verification surface. The hosted product is `https://dash.chmonitor.dev/overview?host=0` (public demo). Do not add a host.

## Sub-features

- `overview-route` loads `/overview` with `?host=` preserved.
- `overview-tabs` switches the underline tab strip (`data-active` on the selected trigger).
- `overview-kpis` renders the chart grid from `/api/v1/charts/{name}`.
- `overview-demo` uses the public demo host as anonymous; signed-in cloud users hide demo (do not sign in to "fix" an empty welcome).

## How to get to it (user POV)

- Open `https://dash.chmonitor.dev/overview?host=0` in a browser (anonymous).
- From the sidebar, choose **Overview** (`href` `/overview`).
- From the CLI, `chm` / `chm tui` shows the same Overview chart names; that proof belongs in [tui-ops-cockpit](./tui-ops-cockpit.md), not here.

## Driving it with the dashboard

Preconditions:

- Network to `https://dash.chmonitor.dev`.
- Stay anonymous. Do not add a host. Do not use `chm auth login` for this recipe.
- Local `pnpm run dev` on `:3000` is optional and often absent in Cloud agents; prefer the hosted URL.

- **Open Overview.** Navigate to `https://dash.chmonitor.dev/overview?host=0`. Document title / heading is Overview. Query string still has `host=0`.
- **Tab strip.** The tab list includes Overview plus the other Overview tabs from `apps/dashboard/src/routes/(dashboard)/-charts-config.ts`. Clicking a tab sets `data-active` on that trigger (Base UI, not `data-state=active`).
- **KPI grid.** Chart cards load; a demo cluster may show data or a graceful empty/error card. A stale/error indicator on a card is not a failed navigation.
- **Proof.** Screenshot of Overview with the sidebar Overview item and `?host=0` visible, plus an accessibility snapshot of the main heading. Do not capture Clerk session cookies.
- **Skip.** If the hosted demo is down (page error, no hosts), record `verified-unreachable` with the URL and status. Do not add a host to recover.

## Gotchas

- Cloud signed-in users **hide** the demo host. Stay signed out for this recipe.
- `/api/healthz` 503 does not mean Overview is down; the page uses chart/table APIs.
- Overview in the sidebar has **no children**, so it never shows the heading customize `+`. Customize proof is a different feature.
- Do not drive this feature by POSTing to connection-create APIs.
