---
name: ui-ux-audit
description: >-
  Headless sweep of every chmonitor dashboard route: console and page errors,
  failed requests, axe-core a11y, horizontal overflow, stuck skeletons, error
  states, and screenshot diffs, with a trace and repro script per finding. Use
  to test all pages, audit the dashboard UI or accessibility, check a change
  or deploy for visual regressions, or reproduce a UI bug across routes.
---

# UI/UX audit

`scripts/audit.mjs` drives Playwright over every route it discovers under
`apps/dashboard/src/routes` and writes a report with a repro per finding. Use
it whenever the check covers more than one or two pages. It is a manual
harness, not CI proof: CI coverage is `e2e-test` and `a11y.yml` (see
`.claude/skills/pstack/features/dashboard-ui.md`).

## Setup (once)

```sh
bash .claude/skills/ui-ux-audit/scripts/setup.sh   # installs into ~/.config/chmonitor/qa-tools
```

## Run

Run from the tools dir so `playwright` resolves. `<skill>` is this
directory's absolute path.

```sh
cd ~/.config/chmonitor/qa-tools
bun <skill>/scripts/audit.mjs --target=local                       # whole sweep
bun <skill>/scripts/audit.mjs --target=local --only=/explorer,/sql # a few routes
bun <skill>/scripts/audit.mjs --target=local --baseline=<prev-run>/shots
bun <skill>/scripts/audit.mjs --target=live                        # dash.chmonitor.dev
```

- **local** expects `cd apps/dashboard && pnpm run dev` with
  `CHM_AUTH_PROVIDER=none` and a real ClickHouse in `.env.local`, so pages
  render with data. Pass `BASE_URL=` if Vite is not on `:3000`.
- **live** reuses a Clerk browser profile in `~/.config/chmonitor/`. Refresh
  it with `bun <skill>/scripts/live-login.mjs`, which runs headed because
  Turnstile only passes in a real window.

Other flags: `--host=N`, `--a11y=off`, `--settle=ms` (default 3500),
`--headed`, `--out=<dir>` (default `/tmp/chm-ui-audit/<target>-<stamp>`).

## Read the output

Open `report.html` first. `report.json` holds the same findings. `shots/` is
the next run's baseline. Routes with findings get `traces/<route>.zip`
(`bun x playwright show-trace`) and `repro/<route>.mjs`, a headed script
anyone can rerun.

- A failed request on local can be a table missing on the dev server. Check
  the route's purpose before filing.
- Fix a11y findings at the usage site, never in `components/ui/`.
- A console error or error state on a route that was clean before is a real
  regression.
