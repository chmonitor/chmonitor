# Sidebar heading customize

Hover `+` on a sidebar **parent group** (for example Queries) opens a dialog of every catalog child. Add / Remove writes `hiddenMenuHrefs` without navigating. Overview has no children and never renders the button. This is a **secondary** dashboard feature. Do not add a host on `dash.chmonitor.dev` to reach it.

## Sub-features

- `heading-open` shows `aria-label="Customize {Group}"` on hover for groups with catalog children.
- `heading-dialog` lists Add / Remove / open-page actions per child href.
- `heading-add-remove` updates hidden menu hrefs, then Done closes the dialog.
- `heading-all-pages` opens Settings → Navigation via `All pages…`.

## How to get to it (user POV)

- Open the dashboard (hosted `https://dash.chmonitor.dev/overview?host=0` or local app).
- In the sidebar, hover a group heading that has children (Queries, Tables, …).
- Choose the `+` control (`Customize Queries`, etc.).
- Related: page header **Customize** / **More** is a sibling entry, not this heading control.

## Driving it with the dashboard

Preconditions:

- Dashboard chrome with the main sidebar is visible (anonymous demo is enough; do not add a host).
- Group title `Queries` exists in `apps/dashboard/src/menu/queries.ts`.
- If the `+` is not in the DOM, stop with `verified-unreachable` (narrow viewport, collapsed sidebar, or catalog empty) — do not invent a host to get more nav.

- **Open.** Query `[data-testid=group-customize-button][data-group=Queries]`. Accessible name is `Customize Queries`. Click it (not the Queries label, which may navigate).
- **Dialog.** `[data-testid=group-customize-dialog]` is visible. Title text is `Queries`. Description: `Add or remove pages in this group.`
- **Rows.** A hidden sibling (e.g. `/failed-queries`) exposes `[data-testid=group-customize-add][data-href="/failed-queries"]`. A visible sibling exposes `[data-testid=group-customize-remove]` and `[data-testid=group-customize-open]`.
- **Add/Remove.** Click Add on a hidden href; the control becomes Remove (hiddenMenuHrefs updated). Reverse with Remove. This is local workspace state — do not require an account.
- **Done.** `[data-testid=group-customize-done]` closes the dialog. `[data-testid=group-customize-all-pages]` is `All pages…` (opens settings; skip unless that sub-feature is in scope).
- **Proof.** Screenshot of the open Queries dialog with at least one Add and one Remove row, plus the testids above in an a11y snapshot. Restore hidden hrefs if you mutated them.

## Gotchas

- Overview never renders `GroupCustomizeButton` (no catalog leaves). Do not look for `data-group=Overview`.
- `showOnHover` — the `+` is easy to miss; query the testid, do not depend on pixel hover in a collapsed rail.
- Dialog is `data-testid=group-customize-dialog`, not the shadcn `Dialog` internals in `components/ui/`.
- Do not mix this with CLI `chm` drives. It does not exist in the TUI.
- Never create a hosted connection to "get a fuller sidebar."
