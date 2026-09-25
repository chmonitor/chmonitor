# Dashboard UI

The dashboard is a TanStack Start application with a static shell and
client-fetched data. A UI proof must show the requested route and host state,
not merely that a page file imports successfully.

## Sub-features

- `ui-route-shell` renders a dashboard route with `?host=0` and no uncaught
  client exception.
- `ui-navigation` moves through sidebar groups and preserves the host query
  parameter.
- `ui-responsive` covers the docked rail at desktop widths and the overlay
  sheet below the `lg` breakpoint.
- `ui-state` has an intentional loading, empty, error, and stale-data state
  rather than a blank or stuck shell.
- `ui-a11y` checks labels, landmarks, focusable controls, and WCAG A/AA
  structure on the representative routes.
- `ui-deploy-shell` checks that the deployed HTML references the client entry
  bundle and that the configured client auth provider is represented when the
  deployment is authenticated.

## How to get to it (user POV)

- Open `/overview?host=0` in the dashboard.
- Use the sidebar to open a nested page such as `/running-queries?host=0` or
  `/sql?host=0`.
- Resize below `lg` and use the sidebar trigger to open the overlay sheet.
- For a hosted public read-only check, use
  `https://dash.chmonitor.dev/overview?host=0` anonymously. Do not create a
  hosted connection to make a UI check pass.
- For settings and onboarding, use the visible routes such as `/alert-settings`,
  `/insights-settings`, `/settings`, and `/setup` when the changed feature is
  one of those surfaces.

## Driving it with CI

Preconditions:

- The PR or commit is known.
- No local browser, ClickHouse, Clerk, or QA dependency is required for the
  default proof.

- **Broad route shell.** In `.github/workflows/test.yml`, inspect `e2e-test`.
  It runs the Cypress `page-render-sweep.cy.ts` list from the current
  `apps/dashboard/src/routes/(dashboard)` tree and records a failure for any
  route with an uncaught exception. The parity guard in
  `apps/dashboard/scripts/page-sweep-parity.test.ts` makes route-list drift
  visible in `unit-tests`.
- **Navigation and host state.** Inspect the Cypress specs
  `sidebar-navigation.cy.ts`, `navigation.cy.ts`, and `host-switching.cy.ts` in
  the same `e2e-test` job. The observable proof is a changed URL with the
  `host=0` parameter preserved, a rendered body, and the expected page route.
- **Accessibility.** Inspect `.github/workflows/a11y.yml`, job `axe-core`, for
  `overview`, `dashboard`, `tables`, `running-queries`, and `about`, each with
  `?host=0`. The job reports WCAG 2 A/AA findings and is explicitly
  non-required. A green result does not replace the route sweep.
- **Deployment shell.** Inspect `.github/workflows/cloudflare.yml`, job
  `dashboard`, step `Verify deployment`. It runs
  `apps/dashboard/scripts/verify-deploy.ts` against the preview or production
  Worker and checks `/overview?host=0`, the client entry asset, and the
  anonymous API gate.
- **Manual broad audit.** `.claude/skills/ui-ux-audit/` can discover routes,
  capture console errors, inspect overflow and skeletons, and run axe. Its
  source still contains legacy `dash-tsr` live defaults and an external tool
  setup step, so do not treat it as the CI proof or run its installer from a
  validation-only worktree.
- **Evidence.** Record the workflow URL, job name, route list or job step, and
  the observed result. For a failed job, use the documented
  `gh run view <RUN_ID> --job <JOB_ID> --log-failed` command and quote the
  route plus the actual error.

## Gotchas

- The page-render sweep proves shell rendering, not live ClickHouse data or
  visual quality. A graceful empty or error card can be the correct state for a
  test environment without a database.
- The browser URL uses `?host=N`; API requests use `hostId`. Do not prove a UI
  host switch by calling an API with the wrong parameter.
- Below `lg`, the sidebar is an overlay and the docked node is not initially
  present. Wait for the trigger and sheet rather than treating the first DOM
  snapshot as a layout regression.
- Base UI uses `data-open`, `data-closed`, and `data-active` conventions rather
  than the old Radix `data-state` selectors.
- A `503` from `/api/healthz` can mean the monitored ClickHouse source is down;
  it does not by itself mean that the browser shell failed to render.
- The a11y workflow is informational. Record violations and the route, but do
  not call the entire UI verified from a non-required job alone.
- Do not capture Clerk cookies, local storage, tokens, or private host details
  in screenshots or traces.
