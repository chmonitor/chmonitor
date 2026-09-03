# Sidebar navigation

The dashboard sidebar is a docked 16rem rail at `lg` (1024) and up, and a touch overlay sheet below it. Fresh profiles get the Essential keep list (Custom + `DEFAULT_HIDDEN_MENU_HREFS`); stored Full / DBA / Engineer / SRE / Custom profiles keep their own rail. Hidden pages stay reachable through More, ⌘K, and direct URLs. This is a **secondary** dashboard feature. Do not add a host to reach it.

## Sub-features

- `rail-overlay-chrome` below `lg`: leaf rows show only the pin; group headings show chevron + Customize `+`; Hide / Add are `display: none`; the rail never scrolls sideways.
- `rail-docked-hover` at `lg`+: row actions are hover / focus revealed; at rest nothing shows.
- `nested-active` the parent group opens when navigation lands on a child (⌘K, breadcrumb, in-page link); a manual collapse holds until the next move.
- `palette-hidden` ⌘K lists hidden pages with a `Hidden` hint; landing on one shows `Keep in sidebar`.
- `profiles` fresh = Custom + Essential hide list; stored Full shows every group with no More row; a named preset shows its group set plus More; an all-hidden Custom still shows More (no stranding).
- `heading-dialog-375` the group Customize dialog fits 375 and Remove updates the rail (details in [sidebar-heading-customize](./sidebar-heading-customize.md)).
- `insight-dialog-close` the insight detail dialog closes from its X (#3362), covered here because the preview cards on `/insights-settings` need no LLM.

## How to get to it (user POV)

- Open the dashboard (`/overview?host=0`). At 375 / 768 tap the sidebar trigger (`data-sidebar="trigger"`) to open the overlay. At 1280 the rail is docked.
- Press ⌘K / Ctrl+K, type a page name, Enter. Hidden pages carry a `Hidden` hint.
- Hover a row on the docked rail for Hide / Add / Pin (leaves) or Customize `+` (groups).

## Driving it with the dashboard

Preconditions:

- A dashboard at `VERIFY_DASH_URL` (local `pnpm run dev` on `:3000`, or hosted `https://dash.chmonitor.dev`; stay anonymous, do not add a host).
- Chrome on the machine (`VERIFY_CHROME` or `google-chrome` / `chromium`) and `puppeteer-core` under `VERIFY_PUPPETEER_DIR` (default `/tmp/verify-chmonitor/puppeteer`): `npm i --prefix /tmp/verify-chmonitor/puppeteer puppeteer-core`.
- `/insights-settings` exists (the `insight-dialog-close` check uses its mock preview cards).

```bash
VERIFY_DASH_URL=http://localhost:3000 node .cursor/skills/verify-chmonitor/scripts/dashboard-sidebar.mjs
```

- The script runs two headless Chromes: a touch one (`hover: none`, 375 and 768) and a pointer one (`hover: hover`, 1280). Tailwind v4 wraps `hover:` / `group-hover:` in `@media (hover: hover)`, so a plain headless Chrome reports `hover: none` and never reveals hover chrome. Do not "fix" that by removing the blink flags.
- Fresh profiles come from a new browser context; stored profiles are injected into `localStorage.clickhouse-monitor-user-settings` before load. <!-- pragma: allowlist secret -->
- **Proof.** `$VERIFY_EVIDENCE/sidebar-navigation.json` (every check with `ok` and `detail`) plus `sidebar-*.png` screenshots. Exit 1 when any check fails. Run `scripts/redact-check.sh` on the evidence dir.
- **Baseline.** To watch it go red, check out the pre-fix `apps/dashboard/src` (`git checkout <sha> -- apps/dashboard/src`), rerun with another `VERIFY_RUN_ID`, then `git checkout HEAD -- apps/dashboard/src`. Compare the two JSON reports.

## Gotchas

- Below `lg` the docked `[data-sidebar="sidebar"]` is not in the DOM until the overlay opens; wait on `[data-sidebar="trigger"]`, not the sidebar.
- The overlay slides in for ~150ms. A screenshot taken during the slide shows rows cut off on the left; that is the animation, not a layout clip (#3347 left-edge report). Wait until the sheet reaches `x = 0`.
- Active rows carry a bare `data-active` attribute (Base UI), not `data-active="true"`.
- `Data Explorer` is listed under both Tables and Tools; on `/explorer` both parents open and both rows are active. That is deliberate (#3175).
- A profile with every leaf hidden is not stranded: More, About, Docs, Settings stay, and every URL still resolves.
