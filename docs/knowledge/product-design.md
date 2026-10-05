---
id: product-design
title: Product design system & UX conventions
type: reference
status: active
updated: 2026-10-05
tags:
  - design-system
  - ui
  - ux
  - tailwind
  - shadcn
  - tokens
related:
  - conventions
  - cluster-topology
  - cloud-saas-mode
---

# Product design system

The durable reference behind the `product-design` Claude skill
(`.claude/skills/product-design/`). New features should match these patterns.

## Theme tokens (OKLCH, CSS-first Tailwind v4)

Defined in `apps/dashboard/src/styles.css` via `@theme` blocks — **no
`tailwind.config.ts`**. Dark mode is `.dark` class (`next-themes`,
`attribute="class"`, `defaultTheme="system"`). Always use semantic tokens; they
flip automatically between themes.

Semantic tokens: `background foreground card card-foreground popover
popover-foreground primary primary-foreground secondary secondary-foreground
muted muted-foreground accent accent-foreground destructive border input ring`.

Light is a near-neutral grayscale (`--background: oklch(1 0 0)`, `--foreground:
oklch(0.145 0 0)`, `--border: oklch(0.922 0 0)`, `--muted-foreground:
oklch(0.556 0 0)`). Dark inverts (`--background: oklch(0.145 0 0)`, `--border:
oklch(1 0 0 / 10%)`).

Chart series: `--chart-1..5` in OKLCH (orange/blue/dark-blue/yellow-green/green),
plus HSL extras `--chart-6..13`, plus named accents for semantic series:
`--chart-red` (errors), `--chart-blue` (info), `--chart-green` (success),
`--chart-yellow` (warnings). Only pass tokens defined in `styles.css` to a
chart's `colors` prop — `seriesColorVar` emits `var(<name>)` verbatim, so an
undefined token computes to black (invisible on dark). Semantic badge pairs
exist as `--badge-{purple,blue,green,amber,pink,slate}` + `*-bg`.

**Series-color arithmetic (one helper).** `area.tsx`, `bar/utils.ts`
(`colorForCategoryIndex`), and `donut.tsx` all resolve a series/category color
through the shared `seriesColorVar(index, colors?)` in
`components/charts/primitives/series-color.ts`: an explicit `colors` list when
given, else `var(--chart-1..13)` ascending, else golden-angle HSL hue rotation
beyond the 13 defined tokens. Don't reintroduce a fourth per-primitive
arithmetic — add overflow handling to `seriesColorVar` instead.

**`bg-chart-N` fallback fills must be static literals.** `ProportionList`
(`components/charts/primitives/proportion-list.tsx`) and its chart consumers
(`query-type.tsx`, `log-level-distribution.tsx`, `query-cache-usage.tsx`) pick
a fallback fill class from the shared `CHART_BG_CLASSES` array
(`components/charts/chart-bg-classes.ts`) — never build `` `bg-chart-${n}` ``
at runtime. Tailwind's content scanner only emits classes it can see as
literals in source; a template string is invisible to it and gets purged from
the production bundle (it happened to "work" in dev only because another
file's own literal list kept the classes alive network-wide). Palette-class
status colors (error/warn/ok swatches in these same files, plus
`system/disk-usage.tsx`) carry an explicit `dark:` variant
(`bg-red-500 dark:bg-red-400`-style) since they intentionally bypass the
`--chart-N` tokens for semantic meaning.

Radius: `--radius: 0.625rem` (10px) → `rounded-sm` 6px / `rounded-md` 9px /
`rounded-lg` 10px / `rounded-xl` 14px.

Fonts: Geist Variable (sans) + Geist Mono.

**OKLCH gotcha:** prefer `oklch(from var(--x) l c h)` for derived colors over
`hsl(var(--x))` — see `cluster-topology.md` for the dynamic-color lightness bug.

## User appearance settings (Settings dialog)

**Entry:** the sidebar footer chrome sits beside Sign In / the avatar
(`[what's new] [gear] [control]`, `flex items-center gap-1.5`) via
`WhatsNewButton` + `NavSettingsButton` /
`NavUserFooterRow` (`apps/dashboard/src/components/nav-user/nav-settings-button.tsx`).
What's new uses lucide `Newspaper`, `aria-label="What's new"`,
`data-testid="whats-new-button"`, 44×44 below `lg`, and a primary **dot** when
`UserSettings.lastSeenChangelogVersion` is older than `APP_VERSION`. The
dialog is owned by `WhatsNewProvider` (sibling of the shell chrome, not inside
the user menu). The same dialog also opens from a **What's new** item next to
About in the user dropdown (`WhatsNewMenuItem`) and from an action on
`/about`. Auto-open once on upgrade; dismiss / Got it writes last-seen.
The dialog is a flex column (`max-h-[min(36rem,85vh)] overflow-hidden p-0`):
header and footer are `shrink-0`; only the notes list
(`data-testid="whats-new-dialog-body"`, `min-h-0 flex-1 overflow-y-auto`)
scrolls. Native overflow on that body — not `ScrollArea` + `flex-1` — so a
tall list cannot paint under GitHub Releases / Changelog / Got it. Footer
resets the primitive's `-mx-4 -mb-4` (`mx-0 mb-0`) because the dialog is
`p-0`. Initial focus is the title (`tabIndex={-1}` + `initialFocus`), and the
body `scrollTop` resets on open, so markdown links in older notes cannot
`scrollIntoView` the list to the middle. Each version can show a row of
screenshot **thumbnails** (`WhatsNewScreenshotGallery`); click one to
open a full-size overlay inside the same dialog (`WhatsNewScreenshotLightbox`).
Do not put `relative` on `DialogContent`: `cn()` drops the
primitive's `fixed`, so `top-1/2 left-1/2 -translate-*` no longer centers in
the viewport. `fixed` already contains that inner `absolute` overlay.
Escape / close dismisses the overlay first, then the dialog. Notes come from `GET /api/v1/releases` (server-side GitHub Releases with
`docs/whats-new` friendly copy first). Airgap fallback is a **build-time
snapshot** of latest `v*` notes, not the full CHANGELOG.md. Settings icon is lucide `Settings` (`size-4`, `strokeWidth={1.5}`),
`aria-label="Open settings"`, `data-testid="nav-settings-button"`, tooltip
"Settings". Hide when `canUseSettings` / `SETTINGS_FEATURE_PERMISSION` is off.
Local settings do not need an account — the gear stays outside `SignInButton`
and `DropdownMenu`, and the `SettingsDialog` is a sibling of the menu. ⌘,
(`useSettingsShortcut`) still opens the same dialog. Do not invent a second
settings store.

`UserSettings` (`lib/types/user-settings.ts`, localStorage
`clickhouse-monitor-user-settings`, merged over `DEFAULT_USER_SETTINGS` via
`mergeUserSettings` so legacy blobs pick up new keys) carries the
timezone/theme plus **units** (`byteUnit`, `numberFormat`), **colors**
(`chartPalette`), **layout** (`tableDensity`, `defaultTimeRange`), a
**workspace** (`workspacePreset`, `hiddenMenuHrefs`), and
`lastSeenChangelogVersion` for the What's new dialog. The
Settings dialog (`components/settings/settings-dialog.tsx` +
`settings-form.tsx`) uses `rounded-xl border bg-card`, a Settings icon + title
+ "Local to this browser" header, a **stable height**
(`h-[min(42rem,90vh)]`, `sm:max-w-4xl`) so tabs do not resize the panel, and `select-text`
so labels copy. Layout is `p-0`: a flat left rail (section labels
Preferences / Display / Workspace, icon + label rows, selected as a muted
pill, `border-r`) and a content pane whose heading is the active tab.
Below `sm` the rail stacks above the pane so Navigation presets and
Show all fit a 375 dialog.
Theme (Light / Dark / System, next-themes) is a
label-left / thumbnails-right row on Appearance only. Navigation
leads with a workspace **preset** (`Full` / `DBA` / `Engineer` / `SRE` /
`Custom`) plus an in-page sidebar-like menu tree (same Main/Others
groups, chevrons, and leaf icons as `nav-main` / `app-sidebar`). Groups
default **collapsed**; picking a role remounts them closed. Parent rows
are chevron-only (not hideable). Nested child rows use
`SidebarMenuSubButton`, which includes `text-left` (same as
`SidebarMenuButton`) so a settings-tree `<button>` is not centered by
the UA `button { text-align: center }` default; Hide stays `shrink-0`
on the right. Click a leaf to hide or show it; hidden rows stay visible
but muted (same idea as Dim unavailable pages). Expand/collapse is
UI-only. `hideMenuHref` / `showMenuHref` stay on the named preset when
the hide list already matches `hideListForPreset` (hide of an
already-hidden-by-preset leaf is a no-op); they switch to Custom only
when the list diverges. Search filters the tree — no Hide-pages drawer
and never a 40-checkbox wall. Then Dim vs Hide with two menu demos
(Queries + dimmed/missing Backups). Hidden pages stay routable; Settings
gear and the host switcher are never filtered. Workspace visibility is
applied last in `getVisibleMenuItems` and does not replace permission /
cloud / engine gates. The Settings > Navigation tree uses the same
engine filter as the sidebar (`getSettingsNavMenuItems` /
`useActiveHostEngine`): a Postgres host customizes Postgres pages; the
default source engine keeps today's Queries/Cluster tree. Named presets
keep a stable group set; Full is the only auto-expand preset. Custom
uses `hiddenMenuHrefs` as the hide list.
Timezone is a searchable combobox
(`timezone-combobox.tsx`) with the browser local zone pinned under Suggested.
Chart palette is a three-card picker with a mini bar preview. Unit options
show a sample on the control (`1.5 GiB` / `1.6 GB`). Integrations lists MCP
(available) plus disabled coming-soon channels. 2–3 choice toggles use
`segmented-control.tsx` (optional `description`; 4+ options wrap to
2 / 3 / 5 columns so the Navigation presets fit a 375 Settings pane).
Show all is full-width under the hide-count line on that pane. Dialog keeps
`data-testid="settings-dialog"`.

**Workspace default:** first-run / missing-workspace blobs use
`workspacePreset: 'custom'` plus `DEFAULT_HIDDEN_MENU_HREFS`
(`lib/menu/slim-default.ts`) — QA keep list is Essential plus Insights,
Explorer, and Query History (Overview, Queries → running + history,
Data & Storage → Tables Overview + Explorer, Alerts & Insights → Insights +
Health, Tools & AI → Chat + SQL). Cluster & Replication, Server, Settings,
and extra children stay off the first-run rail. Full still means every
page (`workspacePreset: 'full'`, `hiddenMenuHrefs: []`). An explicit
stored Full empty hide list is never replaced by the Essential list.
DBA / Engineer / SRE remain **group-title** presets (they still dump
whole groups onto the rail; they are not leaf keep-lists that start from
Essential). Other appearance defaults stay byte-for-byte:
`byteUnit: 'binary'`, `numberFormat: 'abbreviated'`, `chartPalette: 'default'`
(attribute absent), `tableDensity: 'comfortable'` (attribute absent),
`defaultTimeRange: '24h'`.

How each applies (all wired by `AppearanceSettingsProvider`,
`lib/context/appearance-settings.tsx`, mounted at `__root`):
- **Units** are pushed into a module-level snapshot
  (`lib/format-settings.ts`, `get/setFormatSettings`); the plain
  `formatReadableSize` / `formatReadableQuantity` helpers read it as their
  default when no explicit override arg is passed. Because the snapshot isn't
  reactive, already-rendered tables update on their next data refresh, not
  instantly (acceptable v1).
- **Chart palette** → `data-chart-palette` on `<html>`; `styles.css` overrides
  `--chart-1..13` under `:root[data-chart-palette='…']` (after `:root`/`.dark`
  so it wins). `colorblind-safe` = Okabe-Ito, `monochrome` = single-hue ramp.
- **Table density** → `data-density` on `<html>`; `styles.css` tightens the
  `data-slot='table-cell'/'table-head'` padding under `[data-density='compact']`
  (no `components/ui/table.tsx` edit).
- **Default time range** is read as the *initial* value only in
  `lib/context/time-range-context.tsx` (`readInitialTimeRange`), after the URL
  `?range=` param and any persisted click — never overriding an explicit choice.

## shadcn/ui rule

Never edit `src/components/ui/*`. Customise via `className` at the call site or a
wrapper in `src/components/`. Merge with `cn()` (`src/lib/utils.ts` re-exports
the `cn` package). Primitives available: accordion, alert, avatar, badge,
breadcrumb, button, button-group, card, carousel, checkbox, collapsible, command,
dialog, drawer, dropdown-menu, empty-state, form, hover-card, icon-button, input,
input-group, label, popover, progress, resizable, scroll-area, select, separator,
sheet, sidebar, skeleton, tabs, tooltip (+ more).

**`components/ui/` is for pristine shadcn CLI output only** — no app-specific
component belongs there (an import of an app hook/lib is the tell). Bespoke
components that only *look* like they belong (e.g. `debounced-input.tsx`,
which pulled in `@/lib/hooks`) live under `src/components/` instead — moved to
`components/inputs/debounced-input.tsx`. Exception: assistant-ui's documented
setup expects its companion pieces (`message-scroller.tsx`, `attachment.tsx`)
under `components/ui/`, so those stay put.

**Base UI backing (post-#2361).** The primitives are the shadcn **Base UI**
(`@base-ui/react`) distribution, not Radix. When adding/upgrading a primitive or
writing overlay CSS, remember Base UI's contract differs from Radix in ways
`tsc` cannot catch (they live only in `className` strings and keyframes) — this
caused a class of silent runtime breakage in #2361/#2363/#2364:

- **Orientation is a value, not a boolean.** Base UI emits
  `data-orientation="horizontal|vertical"`. The shadcn components style off
  `data-horizontal:` / `data-vertical:` variants, which require the
  `@custom-variant data-horizontal (&[data-orientation='horizontal'])` (and
  vertical) declarations in `styles.css`. Without them Tailwind v4 compiles
  `data-horizontal:` to `&[data-horizontal]`, which never matches → tabs /
  separator / scroll-area / button-group get the wrong flex axis.
- **State is boolean attributes, not `data-state`.** Base UI popups emit
  `data-open` / `data-closed` (use `data-open:` / `data-closed:`), never
  `data-[state=open]`. Collapsible trigger emits `data-panel-open`.
- **CSS vars are renamed.** `--radix-*` → Base UI names: menu/popover width
  `--anchor-width`, popover available height `--available-height`, accordion
  `--accordion-panel-height`, collapsible `--collapsible-panel-height`. A stale
  `--radix-*` reference silently drops the animation/layout it drove.
- **`asChild` → `render`.** Base UI uses a `render` prop, not `asChild`.
- **`Select.Value` shows the raw value** unless you pass `items` (a
  `{ value: label }` record or `{ value, label }[]`) on `Select.Root`, or
  a render-function child. `placeholder` is empty-only — selected `24` /
  `__all__` otherwise paint those strings in the trigger. Incident: the
  Advisor pick-query dialog (#3139). Compare Source/Target
  (`HostPairFilter`) must pass `items` as id → peer name so the closed
  trigger shows `clickhouse-0`, never `0`.
- Ground-truth attribute/var names live in
  `node_modules/@base-ui/react/**/*DataAttributes.js` / `*CssVars.js`.

## Anti-patterns ("AI slop")

Signals that a component was over-decorated rather than designed — each of
these adds a channel that duplicates a signal another element already carries.
Prefer ONE clear signal per piece of state, not several redundant ones.

- **No decorative full-saturation accent bars/rails on cards.** A colored
  left/top border stripe on top of an already-colored card border is
  redundant — severity should already read from the border color, a status
  pill/badge, and/or the value color. Incident: `health-card-shell.tsx` had
  both a subtle `border-amber-500/30` AND a full-opacity 3px left rail for
  the same warning state — the rail was removed, the border alone carries it.
- **No gradient blobs / glow orbs behind icons or headers** unless the brand
  system itself uses them (it doesn't — see Brand below). A plain icon in a
  bordered square (`InsightsGlyph` pattern) reads cleaner than a soft-glow
  circle.
- **Don't stack more than one severity/status signal per element** — pick the
  cheapest that reads clearly (usually: border/text color + a labeled pill).
  Sparklines, icons, and badges are fine in combination when each carries
  *different* information (trend vs. category vs. severity), not the same one
  restated.
- **Prefer the design system's existing idiom over inventing a new visual
  language.** Before adding a new card treatment, dialog style, or badge
  variant, grep for an existing one in `components/` — see "Canonical idioms"
  in the `product-design` skill.

## Component patterns

- **Charts:** `ChartContainer` (`components/charts/chart-container.tsx`) handles
  skeleton/error/empty; `ChartCard` (`components/cards/chart-card.tsx`) provides
  title, SQL view, `CardToolbar` metadata (queryTime/rowsRead/data sizes), stale
  indicator, retry, optional date-range + log-scale. Fetch with `useChartData`
  (`lib/query/use-chart-data.ts`). Card styles centralised in
  `components/charts/chart-card-styles.ts`.
- **Anomaly overlay (Statistics Insights):** the `AreaChart` primitive takes an
  opt-in `anomalyOverlay: { category }` prop (`types/charts.ts`). When set, it
  draws a trailing moving-average line + ±k·σ band (a `fill:none` Area is the
  line — recharts' `AreaChart` ignores `<Line>` children) and flags out-of-band
  points with a custom Area `dot` (this recharts build can't resolve
  `<ReferenceDot>`), plus an optional absolute threshold `ReferenceLine`. The
  band uses a **prior-only window** (excludes the current point) so a spike can't
  mask its own anomaly. Params/visibility come from `useStatsInsightsSettings`
  (localStorage + CustomEvent, mirrors `useInsightsSettings`); the pure math +
  tests live in `lib/insights/anomaly-overlay.ts`. Undefined prop ⇒ zero change
  for every other area chart. Enabled on the `/queries/insights` charts.
- **Data tables:** `components/data-table/` — resizing, wrap toggle, sorting
  (`sorting-fns.ts`), pagination, faceted filters, row actions, SQL display.
  Synthetic ids `__expand`/`select`/`action` are non-data.
- **Page-level grid/table view toggle:** a small segmented control
  (lucide `LayoutGrid`/`Table2`, styled like `components/query-tables/view-toggle.tsx`)
  in the `PageHeader` `actions` slot. Persist the choice in **localStorage**
  (not a URL param) via a pure read/write helper + a tiny hydrate-on-mount hook
  so the static shell stays deterministic. Reference: the Fleet Overview page —
  `components/fleet/fleet-view-toggle.tsx` + `fleet-helpers.ts` +
  `use-fleet-view.ts` (key `fleet-view`, default `grid`).
- **Clickable table row → detail Sheet flyout:** `DataTable`'s `onRowClick`
  prop (threaded through `TableClient` → `QueryPageLayout`, desktop rows
  only — mutually exclusive with `expandable`, which owns row clicks when
  set) fires with the row's data when the click lands outside interactive
  cell content (same guard as inline expansion, `isRowClickTarget` in
  `renderers/table-body.tsx`). The page holds `useState` for the selected
  row + Sheet open flag and renders a `<Sheet>`-based detail component
  alongside `<PageLayout>`. Reference:
  `routes/(dashboard)/slow-query-patterns.tsx` +
  `components/slow-query-patterns/pattern-detail-sheet.tsx` — the Sheet's
  heavy content lives in a child component only mounted while `open` is
  true, so its data fetches don't run while the flyout is closed.
- **Empty:** `components/ui/empty-state.tsx`, variants `no-data | no-results |
  error | loading | offline | table-missing | timeout | filtered-empty`. Each
  variant renders a **bespoke ~40×40 mini-illustration** (empty tray, magnifier-
  over-nothing, severed plug, hourglass, …) from `EmptyStateIllustration`
  (`components/illustrations/empty-state-illustration.tsx`) inside the shared
  circle frame — differentiate the illustration, not the chrome. `ChartError`
  routes its detected cause through `toEmptyStateVariant` → `EmptyState`, so a
  chart failure automatically gets the matching illustration. Table query
  failures (`TableClient`) use the full EmptyState, not `compact`, so timeout
  and missing-column copy stays visible.
- **Recommend-only DDL pairs** (Advisor / schema-diff): when topology is
  known, show the local table name and a copyable `ON CLUSTER` variant of
  the same statement (`components/ddl/recommend-ddl-blocks.tsx`, transform
  in `lib/ddl/on-cluster.ts`). Single-node stays one statement. Never
  execute or add a Run button. Schema Compare copy-all lives
  on the source/target toolbar; catalog checkboxes pick tables for
  the sync script; the plan card copies the open table only.
- **Interactive tool pages** (Explain, Advisor): before the first run, a
  dashed-border `EmptyState variant="no-data"` ("Nothing to analyze/explain
  yet"). User-input issues — table-less SQL like `SELECT 1`, a missing
  `query_id` — use the same EmptyState with next steps, never `ErrorAlert`
  titled "Analysis failed". `ErrorAlert` is for host/schema/fetch failures.
  Picking a query from the picker auto-runs, same as `/explain`.
  Advisor (`/advisor`) defaults to Schema & Settings; Query Advisor is the
  second tab (`?query=` / `?queryId=` still open it). The schema surface
  reuses Explorer `DatabaseTree` (search plus All / Needs attention / Hide
  suggested, group, and sort). Care tables use one amber `chart-yellow` dot.
  Detail is recommend-only (`TuningFindingsPanel`); the all-good empty state
  includes tips for creating new tables. Never Apply/Run DDL.
- **Illustrations:** bespoke, theme-aware, token-driven, motion-safe inline SVGs
  in `components/illustrations/` — prefer over a lone lucide glyph for
  high-impact moments. `WelcomeIllustration` (first-run hero),
  `AgentGreetingIllustration` (agent greeting hero), `EmptyStateIllustration`
  (per-variant minis), `BrokenWireIllustration` (connection-error panel:
  browser→chmonitor→source flow with the failed hop severed, keyed off
  `ConnectionErrorKind`). Rules: colour only from `currentColor` + Tailwind
  palette utilities (`fill-chart-1`, `text-chart-red`, `fill-orange-500`,
  `fill-emerald-500`) — never a raw hex/oklch or `hsl(var(--…))` literal (breaks
  on OKLCH tokens); animation only under `motion-safe:` (never SMIL), add
  `motion-reduce:animate-none` on pulses. Template: `FlowConnector` in
  `components/connections/connection-help-panel.tsx`. Static art for the
  marketing/docs sites lives in repo-root `assets/illustrations/` (synced like
  `screenshots/`/`backgrounds/`).
- **Skeletons:** `components/skeletons/` — match final layout (no layout shift).
- **First-run:** `components/host/first-run-gate.tsx` →
  `first-run-empty-state.tsx` (cloud signed-in / cloud anon / self-hosted).
- **Sidebar favorites:** each item is a real link (`cursor-pointer`). The pin
  is hover-only on that row (never always-on). Favorites also show a grip
  handle on hover; drag it to reorder (`nav-favorites.tsx`) — `lg`+ only,
  touch uses the row's "…" menu (see *Overlay leaf chrome* below). Order is the
  `chm-pinned-favorites` localStorage pin list (`lib/menu/favorites-store.ts`).
  Leaf rows also reveal Hide (EyeOff) beside the pin; that writes
  `hiddenMenuHrefs` via `hideMenuHref` and toasts Undo + Open Navigation
  (Settings → Workspace → Navigation). Footer About is not hideable this way.
  Hover **+** (`add-button.tsx`) lists hidden siblings in that catalog group
  (Queries + → History, Slow, Failed; Tables + → Replicas, TTL). Click
  adds with `showMenuHref` and does not navigate; an arrow opens the page.
  Group headings show a hover **+** / Customize (`group-customize-dialog.tsx`)
  **inline immediately after the title**, with the expand chevron flush
  right (`[icon] [label] [+] …… [>]` — #3386). Do not use absolute-right
  `SidebarMenuAction` on the heading (leaf pin/hide/add still do). The
  heading trigger is a non-button (`nativeButton={false}`) so the Plus
  can be a nested `<button>` without invalid HTML. Clicking + must
  `stopPropagation` so it does not toggle the group. The control opens a
  dialog titled with that group and lists **all catalog
  children**: visible rows have Remove (`hideMenuHref`); hidden rows are
  muted with Add (`showMenuHref`). Toggle updates the rail immediately.
  An explicit Open arrow navigates; Done closes; optional All pages… opens
  Settings → Navigation focused on the group (not the default path). This
  dialog is the 375 customize surface — no overflow-x, do not rely on the
  cramped hover +/hide/pin row. **Overlay leaf chrome (below `lg`, #3580):** the
  hover Pin, Hide, Add and the Favorites grip are all `max-lg:hidden`
  (docked rail, hover-only). Every page row (top-level leaf and sub-item)
  instead gets one trailing **"…"** button — `RowActionsMenu`
  (`nav-main/row-actions-menu.tsx`), `aria-label="Page actions"`, a 36px
  (`size-9`) target, `lg:hidden`, stepping left of the badge when the row
  has one. It opens a `DropdownMenu`: **Pin / Unpin**, **Hide from sidebar**
  (same `useHideMenuItem` undo toast as the hover button), and — only for
  rows inside the Favorites group — **Move up / Move down**, disabled at
  the first / last row. There is no drag reorder and no long-press on touch.
  Reorder goes through `moveFavorite(href, direction, order)` in
  `lib/menu/favorites-store.ts`; `nav-favorites.tsx` supplies the *rendered*
  order via `FavoritesOrderProvider` so a stale pin never swallows a step.
  The menu is keyboard operable (Enter/Space opens, arrows move, Escape
  closes). New row actions go into this menu for touch and get a hover
  button for `lg`+ — never a second always-visible icon on the overlay row.
  Group headings keep the Customize `+` visible on the overlay, including
  768 tablets — use `overlayActionClasses` (`nav-main/overlay-action.ts`),
  not `SidebarMenuAction showOnHover`, whose `md:opacity-0` hides it there.
  `SidebarContent` in `app-sidebar.tsx` is `overflow-x-hidden` so those hit
  areas never become a sideways scroll. **Nested active:** the group
  `Collapsible` is controlled — it opens whenever the active child href
  changes (⌘K, breadcrumb, in-page link) and a manual collapse holds until
  the next move; `defaultOpen` alone left the active row hidden after
  client-side navigation. Overview (no children) has no heading
  dialog. Footer About is never hideable. Footer Customize… on leaf hover
  still opens Settings → Navigation, preferably focused on that group. A
  **More** row (`more-pages-button.tsx`) is a searchable flyout of hidden
  leaves (click navigates; hover Add / Pin; footer Customize… and Show
  all). Full with hide count 0 hides the row. Below `lg` the catalog is an
  inline panel inside the overlay sidebar — it does not open the 375
  Settings dialog unless Customize is tapped. Essential keeps grouped
  parents (Overview is a leaf; Queries → Running + History, Data & Storage →
  Tables Overview + Explorer, Alerts & Insights → Insights + Health, Tools & AI
  → Chat + SQL) — do not flatten those groups to Chat / SQL leaves.
  Settings → Navigation has **Show all** (applies Full) when the preset
  is not Full.

- **Unavailable pages — two classes, one policy (#3463).** A nav row that is
  not fully available resolves through ONE pure function,
  `resolveUnavailable` (`lib/menu/unavailable-visibility.ts`), reached from the
  hooks in `components/menu/hooks/use-unavailable-visibility.ts`. Never
  re-derive it at a render site — the expanded rail's leaf path
  (`nav-main/menu-item.tsx`), its sub-item path, the collapsed flyout
  (`nav-main/collapsed-submenu.tsx`), and ⌘K (`usePaletteMenuItems`) all call
  it, so the surfaces cannot disagree. Two classes, and they are not the same
  call:
  - **Structurally impossible** — the item declares `tableCheck` and the
    backing system table is missing/unreadable on this host. It can NEVER work
    here, so under the default it leaves the rail. (`/traffic` on the cloud
    demo, whose read-only user cannot read `system.query_log`.)
  - **Not configured, but enableable** — the item declares
    `requiresMetadataDb` and no state backend resolves (D1 / ClickHouse state /
    Postgres — `resolveStateBackend()`). The operator
    can turn it on, so hiding it would delete the discovery path for a feature
    that ships in the box. It DIMS. (`/report-settings` → Scheduled Reports.)
  `hideWhenUnavailable: true|false` on a `MenuItem` overrides the class in both
  directions — the opt-in for class 2, the escape hatch for class 1. Do not set
  it redundantly: `tableCheck` already implies hide.
  The verdict is `available | dimmed | hidden`, and the signals behind it travel
  with it, so the tooltip copy (`unavailableReasonText`) also has one home.
  - **Default is Hide** (`dimUnavailablePages: false` in
    `DEFAULT_USER_SETTINGS`) so a clean rail is out of the box. Settings →
    Navigation → *Unavailable pages* still offers Dim, and a stored `true`
    survives the flip (`mergeUserSettings` spreads stored over defaults) — the
    change moves the out-of-the-box state, not anyone's choice.
  - **Never hide from an unsettled map.** `useTableAvailability` is fail-open
    (a table is available unless the map says `false`), and `resolveUnavailable`
    pins that at the decision site via `availabilityLoading`. Reversing it
    would be worse: the common case is a host where everything IS available, so
    hiding-while-loading makes every such page flash in and out on every mount,
    versus one settled removal for the few that genuinely cannot run.
  - **A group whose every child is hidden renders NO parent row.** The guard in
    `CollapsibleMenuItem` sits AHEAD of the collapsed/expanded branch, so both
    states are covered — same rule as a data-dependent section elsewhere in the
    app: no heading with a dangling chevron and an empty body.
  - **Hidden-because-unavailable ≠ hidden-by-the-user.** The page stays
    routable by direct URL and the charts explain themselves. It does **not**
    get the *Keep in sidebar* chip (`keep-in-sidebar.tsx` gates on the user's
    `hiddenMenuHrefs`, which availability never touches) — the user did not hide
    it and there is nothing to restore.
  - **⌘K indexes them apart.** Workspace-hidden pages stay indexed with a
    Hidden hint (the user chose that, and ⌘K + *Keep in sidebar* is the way
    back). Availability-hidden pages are dropped: nobody chose it, it is not
    reversible from the palette, and landing there only produces "System table
    not found on this host". Dimmed (config-gated) pages stay indexed — they
    work once configured. `filterUnavailableVisibility` drops the empty parents
    the same way `filterCloudOnly` / `filterHiddenMenuHrefs` do.
  - **Blast radius worth remembering:** Merges, Metrics, Logs, System, and
    Operations are 100% `tableCheck`-gated, so a host missing all of those
    tables loses all five groups from the rail. That is correct (those pages
    have nothing to show) but it is why the default flip needs the Dim escape
    hatch, not a hard-coded removal.

- **Alerts in the sidebar (#3291):** there is no standing Alerts catalog
  item. `revealAlertsWhenActive` injects an Alerts leaf (href
  `/alert-settings`, existing Active Alerts page) under Health — or after
  Overview if Health is hidden — only while `useNotifications` reports a
  count. Zero notifications → absent. Does not duplicate if Alert Settings
  is already visible.

- **Dashboard widget grid** (plan 57, `components/dashboard/`): `grid.tsx`
  lays out `DashboardWidget[]` (chart/table/stat/text, `@/types/dashboard-layout`)
  on a fixed 12-column CSS grid; view mode is plain positioned `div`s, arrange
  mode adds `@dnd-kit/core` drag-to-move + pointer-event corner resize, both
  rejecting (snap-back) a move/resize that collides with another widget
  (`widgetsCollide`/`findFreePosition`). `widget-frame.tsx` is the shared
  chrome (title bar, drag handle, remove, resize handle — edit-mode-only).
  A dashboard-scoped `DashboardTimeRangeProvider`
  (`components/dashboard/time-range-context.tsx`, distinct from the app-wide
  `lib/context/time-range-context.tsx`) drives every chart widget's baseline
  `lastHours`/`interval` via explicit props, which outrank both the chart's
  own default and the global header time-range picker.
- **Floating agent widget (page-aware + dockable):** the app-wide chat bubble
  (`components/assistant-ui/assistant-modal.tsx`, on top of assistant-ui's
  Radix-Popover `AssistantModalPrimitive`) has two remembered layouts —
  `floating` (bottom-right popover) and `docked` (full-height right sidebar,
  `fixed inset-y-0 right-0 w-[min(28rem,100vw)] border-l`). Because Radix
  Popper wraps content in a transformed positioner (which traps a `fixed`
  child), the docked layout is rendered as its own fixed panel outside the
  Popper, with the Root's `open` controlled so it mounts/unmounts (Thread stops
  polling when closed). Mode persists via `useAgentWidgetMode`
  (`lib/hooks/use-agent-widget-mode.ts`, localStorage +
  CustomEvent, same shape as `useAgentModel`). A dismissible **page-context
  chip** above the composer (`-thread/page-context-chip.tsx`) surfaces the page
  the agent can see; its shared state (`page-context-control.tsx`, floating-only
  provider) also gates whether `pageContext` rides along with the request — see
  `docs/content/guide/ai-agent.mdx`.
- **Follow-up suggestion chips (two affordances, one shared look):**
  `-thread/follow-up-chips.tsx` (`FollowUpChips`) is the single pill component
  — `rounded-full border border-border/70 text-muted-foreground`, foreground +
  `bg-muted/60` on hover, `flex flex-wrap gap-1.5` so it wraps on narrow
  widths without layout shift. It takes an `anchored` prop (`border-t
  border-border/60 pt-2`) for callers with nothing else separating the strip
  from what's above it. Two producers render it: (1) `AssistantFollowUpChips`
  in `thread.tsx` passes `anchored` (it sits directly under
  `MessageStatsFooter` inside the message column, with no divider of its
  own) and is driven by `lib/ai/agent/follow-up-prompts.ts` — deterministic,
  client-side, derived primarily from the tool(s) the agent just called
  (`TOOL_FOLLOW_UPS`, keyed by tool name) rather than generic keyword
  matching, so suggestions are genuinely different next steps instead of
  re-asking what the last tool call already answered (a candidate is dropped
  when its `relatedTool` is already in `toolsUsed` this turn); when no tool
  maps, a keyword-rule fallback picks the *highest-scoring* rule (not just the
  first one declared) so a reply that only incidentally mentions an unrelated
  rule's keyword doesn't hijack the match. (2) `FollowUpSuggestions` — the
  AgentState-backed "AI follow-ups" button/row that sits directly above the
  composer — leaves `anchored` off and instead puts `border-t
  border-border/60 pt-2` on its own outer column (it has to cover both the
  ghost-button and populated-chips states), so it reads as part of the
  composer rather than floating loose above it.

### Agent chat: reasoning / tool-call rendering

The thread's "chat machinery" (reasoning blocks, tool-call groups, individual
tool rows) must stay visually secondary to the assistant's own prose — the
reply text is the loudest thing on the page, not the plumbing that produced
it. Implemented in `components/assistant-ui/{reasoning,tool-group}.tsx` +
`components/agents/chat/tool-output/tool-call-part.tsx`:

- **Ghost text row triggers, not background cards.** `ReasoningTrigger`
  ("Thought process") and `ToolGroupTrigger` ("N tool calls") are plain
  `icon + label + chevron` rows (`text-xs text-muted-foreground`,
  `hover:bg-muted/40 hover:text-foreground`, `focus-visible:ring-[3px]
  focus-visible:ring-ring/50`) — **no `bg-muted/50` slab**. Two adjacent
  colored/boxed triggers read as identical heavy blocks and bury the message
  between them; a bare row differentiates by icon (Sparkles vs Wrench) and
  label instead. Their content indents under the trigger (`pl-5` /
  `pl-3.5`) rather than adding another box.
- **Tool-call header: family icon + short summary, never a raw param dump.**
  The collapsed row shows a lucide family icon (`getToolFamily`: query,
  schema, health, disk, replication, merge, skill, plan, visualize,
  ask_user) + `toolName` + a one-line summary. While running, the name stays
  muted with a tiny spinner. On success, `summarizeToolOutput` wins (row
  count, table name, lag, …); otherwise `summarizeToolInput` (`output-shape.ts`)
  — a single-line, whitespace-collapsed, ~60-char-capped string (prefers a
  primary `sql`/`query`/`prompt` param alone over concatenating every
  `key=value`). The full input always lives in the "Parameters" disclosure
  in the expanded body; a long/multiline value there (`isLongToolInputValue`)
  renders as a `CodeBlock` (sql-aware, horizontally scrollable) instead of an
  inline JSON string. Do not add Done/Failed badges on the header — the
  summary (or the compact error row) is enough.
- **Tool errors: a compact destructive row, never raw JSON.** A failed tool
  renders `summarizeToolError(part.errorText)` — a short human message
  (extracted from a `{error:...}`/`{message:...}` JSON payload when present,
  or the plain text as-is, or a generic fallback when there's nothing
  readable) in a `border-destructive/30 bg-destructive/5` row. An expandable
  "Details" disclosure only appears when the payload carries fields beyond
  the message itself — never a bare `{"error":"..."}` blob inline.
- **Embedded result tables are bounded.** `ResultTable` (compact `DataTable`)
  gets `rounded-md border border-border/60` at the call site — compact mode
  has no border of its own — so it reads as one contained card, with its own
  `max-h-[50vh]` scroll and a row count in the footer, instead of floating
  content whose scrollbar fights the page.
- **`.markdown-content` owns no `pre`/`code` background rule** (neither in
  `styles.css` nor `components/agents/markdown-code.css`). Streamdown's own
  `code:`/`pre:` renderers already style both fenced blocks (bordered
  `bg-background` card) and inline code (`rounded bg-muted px-1.5 py-0.5`)
  with token-based Tailwind classes — a sitewide override at that specificity
  paints a second padded background box INSIDE Streamdown's already-bordered
  fenced-block card (its `pre:` renderer returns its child unwrapped, so a
  generic `pre` selector hits the inner token-holding `<pre>`) and shrinks
  inline code's font-size below the block's. Don't re-add one; if code
  styling looks off, fix it in the
  Streamdown-rendered markup's own classes, not a `.markdown-content`
  override. (`.markdown-content` has exactly one consumer, `markdown-text.tsx`
  — safe to keep spare.) The heading/blockquote overrides that DO remain in
  `styles.css` are intentional chat-width right-sizing (Streamdown's own h1 is
  `text-3xl`, tuned for full-page docs) — don't remove those. Tables wrap in
  a horizontal scroll container (`text-sm`, header `bg-muted/40`). Mermaid
  parse failures stay muted (border + source), not a destructive slab.
  Dropped json-render patches (`json-render-patch-guard` or spec validation)
  fail quiet — no empty Card and no yellow warning chip.
- **Message chrome stays quiet.** User turns are a compact end-aligned bubble
  (`max-w` + wrap for long SQL). Assistant prose is flush, no full-answer
  bubble. Copy / retry / edit appear on hover or focus-visible, not as
  standing chrome. One loading indicator after submit.

### Settings channel grid (configured-first)

Settings surfaces that expose many optional integrations (today:
`/alert-settings`, shared with `/health-settings` via `HealthSettingsPanel`)
must not render every integration as a full-width blank form. The convention,
implemented by `components/health/channel-card.tsx`:

- `ChannelCard` — a collapsible card (`ui/collapsible`, Base UI: style off
  `data-open`) whose summary row is `icon + name + status line + badges +
  optional enable Switch + chevron`, expanding to the channel's config form.
  It owns no state, so the browser-local channels (localStorage, saved by the
  page footer) and the server channels (per-card save to D1) can share it while
  keeping different save semantics.
- `AddChannelTile` — compact dashed tile (icon + one-line description + an
  example target value, e.g. a sample Slack webhook URL) for an unconfigured
  channel; clicking it expands the full card.
- `ChannelSectionHeader` — section icon + `h2` + count badge + description.
- Cards render in a `grid gap-3 sm:grid-cols-2`; only CONFIGURED channels get
  cards (`lib/health/channel-classification.ts` — pure + unit-tested:
  browser = enabled, URL channels = non-blank URL, server = D1 row OR
  `HEALTH_ALERT_*` env). Zero configured → `EmptyState`, not blank forms.
- Once the user edits a card, pin it open (`opened` id set) so clearing its URL
  can't collapse the card and unmount the focused input mid-keystroke.
- The unconfigured channels live behind a `ChannelPickerDialog` reached from an
  "Add channel" button in the section header (and from the empty state's
  `action`), NOT as a permanent inline tile grid — a settings page shows what IS
  set up. The dialog renders the same `AddChannelTile`s.

### Custom alert target editor

The custom webhook surface follows the same configured-first rule while keeping
its form logic small and testable:

- `custom-webhook-targets-panel.tsx` owns the target list, storage status, and
  selection; `custom-webhook-target-card.tsx` owns one target draft, preview,
  save, reset, and send-test interaction. Do not grow a single settings form
  that owns every target's state.
- D1 targets are editable cards/selectors; Helm/GitOps targets are read-only
  status rows. If neither source has a target, use `EmptyState` rather than
  rendering an empty form wall.
- The same rule covers every alert-definition list (routes, custom rules,
  quiet hours, maintenance windows, channel config): a row whose API `source`
  is `file` or `env` renders `DeclarativeSourceBadge`
  (`components/health/declarative-source-badge.tsx`, "Config file" / "Env")
  in place of its Delete/Reset control — the operator removes it from its
  source, never from the UI.
- Preview and send-test are explicit actions. The preview is a deterministic
  sample payload formatted by the same server-side formatter as delivery; the
  browser receives only a redacted destination hint, never a raw webhook URL
  or secret header.

### Compact rail sidebar: static primary block + collapsible groups

A narrow (≈320px) settings rail attached to a full-height surface (e.g. the
`/agents` right-hand `AgentSettingsSidebar`) uses a two-tier structure instead
of stacking every section with equal, always-expanded weight:

- **Primary block, never collapses.** The 1-3 controls users reach for most
  (host, model) render as `LabeledRow`s — a fixed-width uppercase tag
  (`text-[9.5px] font-semibold tracking-wider uppercase text-muted-foreground`,
  `w-11 shrink-0`) to the left of the control, all under one small static
  `StaticSectionHeader` (label, optional right-aligned badge, no chevron).
  Read-only/status rows in the same block (e.g. conversation-history backend)
  replace an explanatory paragraph with an info-icon `Tooltip` next to the row
  — see `ConversationHistoryRow` in `agent-settings-sidebar.tsx`.
- **Everything else is a `CollapsibleSidebarSection`** — chevron
  (`ChevronDownIcon`/`ChevronRightIcon`, `size-3`) + section icon (`size-3.5`)
  + `text-[10.5px] font-semibold tracking-wider uppercase` label + optional
  right-aligned count badge, built on `ui/collapsible` (Base UI, controlled
  `open`/`onOpenChange`, no animation needed — `CollapsibleContent` renders
  directly, matching `agent-data-sources.tsx`). Collapsing only hides a section,
  it never removes a control or entry point.
- **Open one section, not all of them.** The primitive defaults to **open**,
  but a rail with N sections passes `defaultOpen={false}` to every section
  after the first, so arrival shows the top section expanded and the rest
  folded. Four panels open at once push the actual controls off the bottom of a
  320px rail and read as clutter; the user opens what they want. Fold state is
  plain component state and **resets on reload** — do not add persistence for
  it, and do not read `defaultOpen` as a "first visit" preference.
- **Every collapsible section carries its count in the `right` slot.** The slot
  renders *inside* the trigger, so the badge stays visible while folded — that
  is the whole reason a collapsed section is still worth showing. When a count
  appears in both the header and the body, derive both from ONE source. A
  per-instance `useState` hook has no cross-instance broadcast, so a second
  instance of the same hook goes stale against the first: either lift the state
  to the common parent and pass it down, or back the hook with a shared store.
  What is forbidden is two independent stores feeding one number. (`useMcpConfig`
  is the reference: a module-level store read via `useSyncExternalStore`, which
  also keeps the agent runtime in step with the panel's toggles.)
- **A data-dependent section keeps its visibility guard ahead of the section
  element**, not inside the body — otherwise OSS / unlimited plans render a
  header with a chevron and no body under it. `AiUsagePanel` returns `null`
  before its `CollapsibleSidebarSection` for exactly this reason.
- A bounded list inside a collapsible section (e.g. the first 3 of N skills)
  still ends in a "View all (N)" button/dialog rather than rendering the full
  list — the collapsible fold is for the section, not a substitute for
  bounding an unbounded list.
- Header copy: a page-level "open full settings" link belongs in the sidebar's
  own title row (icon/text button next to the close button), not as a second
  paragraph + link stacked underneath the title.

### Settings page shape: few tabs, dialogs for the rest

A settings surface with many independent panels gets FOUR tabs at most, and the
rarely-visited panels become a `grid gap-2 sm:grid-cols-2` of launcher cards
(icon tile + title + one-line description + `ChevronRight`) that each open the
unchanged panel inside a `Dialog`. `/alert-settings` collapsed ten tabs into
`Alerts · Thresholds · Activity · Advanced` this way
(`components/health/advanced-settings-panel.tsx`).

**Group launchers by job, next to what they belong with (#3438).** A lone
"Advanced" grid of unrelated cards is a second click nobody knows to make.
The seven alert sections are split into three `AlertSectionGroup`s placed by
`ADVANCED_SECTION_PLACEMENT` (`lib/health/health-settings-tabs.ts`):
`define` (Suggested alerts, Custom rules) under the built-in `CheckAlertList`,
`delivery` (Routing, Webhook subscriptions, Digest) under the channels, and
`silencing` (Quiet hours, Maintenance windows) as the whole Advanced tab. Each
group owns its own dialog and only opens a deep-linked section that it owns, so
the same resolved `advancedSection` can be passed to every group on a tab.
Panels render unchanged, keeping their `HealthStoreNotice` and declarative
source badges.

**Nothing may become unreachable, and no deep link may die.** Keep a
`LEGACY_TAB_MAP` from every retired `?tab=` id to `{ tab, advancedSection? }`,
so an old link lands on the right tab with the right dialog already open
(`health-settings-panel.tsx`).

### Act on the thing you are looking at (health detail dialog)

A card that reports a problem must let you act on *that* problem without
re-deriving its identity. The health detail dialog therefore carries its own
**Configure alert** footer action, opening
`components/health/configure-alert-form.tsx` pre-filled with the check id, the
value already on screen, and the **effective** thresholds
(`overrides[check.id] ?? check.defaults`, which the dialog already receives).
Never re-ask the user to pick the metric or re-type the thresholds.

The form keeps three concepts separate, because the settings page has been
conflating them:

| Control | Medium | Evaluated by | Needs a DB? |
|---|---|---|---|
| **Thresholds** | localStorage `health-thresholds` | the browser dispatcher | no |
| **Named alert** | D1 `custom_alert_rules` | the cron sweep | yes |
| **Channel** | localStorage or D1, per channel | both | depends |

Rules that follow from the table:

- The threshold action is **never** disabled for lack of a database — that is
  the whole self-hosted path.
- The named-alert action is disabled **with a reason** when the store cannot be
  written, never a silent no-op. Availability is tri-state
  (`unknown | available | unavailable`, `components/health/use-alert-signals.ts`)
  and `unknown` must render as *disabled*, not as *enabled*: a 501 probe that has
  not resolved yet is not permission to write.
- `metadataDb.available` from `GET /api/v1/config` is **not** a valid gate for
  this. Since #3493 it derives from `resolveStateBackend()`, which counts a
  ClickHouse state backend — and no alert store has a ClickHouse
  implementation, so a ClickHouse-only deploy reads `available === true` and
  then gets a 501 on write.
- **The alert-store write gate (#3495).** Every health/alert settings panel
  that writes asks one hook, `useHealthStoreAvailability({ probeError, store })`
  (`lib/health/store-availability.ts`). It combines `capabilities.health`
  from `GET /api/v1/config` (`{ backend, maintenanceWindowsBackend }`, each
  `'d1' | 'postgres' | 'none'`, resolved server-side with the same
  `resolveHealthBackend()` call the stores use) with the panel's own list read
  as a *veto*: a 501 always wins, so the two cannot disagree in the direction
  that enables a write. Config still loading, a failed config fetch, or an
  older server without the field all yield `unknown`. Gate every write control
  with `canWriteHealthStore(availability)` (true only for `available`) and
  render `<HealthStoreNotice availability feature>`
  (`components/health/health-store-notice.tsx`) for `unknown`/`unavailable`.
  Read surfaces (lists, env-derived values, Helm targets) stay visible. Do not
  write a per-panel 501 check.
  ACK/un-ACK (`active-alerts-panel.tsx`) follows the same gate (#3498):
  `POST`/`DELETE /api/v1/health/ack` answer 501 with no backend, and the
  Acknowledge/Clear controls are disabled unless `available`. Where alert
  sensitivity is tuned (`thresholds-panel.tsx`),
  `<AlertStateVolatilityNotice>` states — only when `unavailable` — that
  alert state is in-memory per worker, so hysteresis streaks and incident
  timers reset on every restart/deploy.

**Already-alerting indicator** (`alert-configured-badge.tsx`, rendered on the
card header, the dense row, and the dialog title): one amber `BellRing` badge,
titled with *why*. It resolves from three sources, cheapest first, via
`lib/health/alert-capability.ts` (pure + unit-tested):

1. a key present in the `health-thresholds` map — **localStorage, so the badge
   still works with no metadata database at all**;
2. a custom rule bound to the catalog metric that measures the same quantity —
   matched through an **explicit** `CHECK_CATALOG_METRIC` table, never by name
   similarity (two look-alike checks deliberately have no entry because their
   SQL differs);
3. an `alert_state` row keyed by this exact `checkId`.

This is a *different* signal from severity — the badge answers "is this
watched?", not "is it bad?" — so it does not violate the one-signal-per-element
rule above. The grid resolves all three sources **once for the page** and passes
the result down as data; cards stay presentational.

### Built-in alert names (#3438)

A built-in alert is keyed by its stable check id, which is also the
`alert_state` / `alert_acks` `ruleId`. The operator-set name is display-only,
so a rename never re-keys state or resets an ACK. The known set is the union
of the browser checks (`HEALTH_CHECKS`) and the server sweep rules
(`BUILTIN_RULES` + `BUILTIN_COMPOUND_RULES`), so every id the sweep can write
is nameable.

- Every surface that lists alerts by `ruleId` (Current alert state, Active
  alerts, Recent alerts) resolves the label through `useCheckAlertNames()`
  (`lib/hooks/use-check-alerts.ts`): stored name → caller's own label (custom
  rule title) → browser check title → raw id. Show the id in a `title`
  tooltip. Never re-add a local `HEALTH_CHECKS.find` lookup.
- `CheckAlertList` (`components/health/check-alert-list.tsx`, Alert Settings →
  Alerts) lists every built-in alert: name, id in `font-mono` muted text,
  a severity badge only while firing on the current host, pencil to rename
  inline, reset only when a stored name exists. The list always renders
  (the API returns defaults with no DB); rename/reset are gated on
  `canWriteHealthStore` with `<HealthStoreNotice feature="Alert names">`.

### Presets before forms

When a settings surface would otherwise render N identical input pairs (16
health checks × warning/critical), lead with a named `SegmentedControl` preset
that covers all of them, then show ONLY the items tuned away from that baseline;
the rest are added from a searchable picker dialog. Presets scale each item's
OWN defaults by a factor (`lib/health/threshold-presets.ts`) rather than writing
absolute numbers, so a "percent" and a "count" check stay proportional, and
"overridden" is judged by comparing VALUES to the defaults — never by key
presence, which a global preset would trip for every item.

Related: a **quick-start template** dialog (`lib/health/alert-templates.ts`) may
set several of these at once. A template must write only into the EXISTING
stored shapes — never add its own persisted field, or the whitelist parsers
(`loadAlertSettings`) will silently drop it — and must never overwrite a target
the user typed (a webhook URL); it decides *when*, the channel cards decide
*where*.

### Numeric threshold input

Use `components/health/threshold-field.tsx` (a wrapper — never edit
`ui/input.tsx`): a severity dot + label, `−`/`+` stepper buttons flanking a
centered `tabular-nums` input, with the step derived from the value's magnitude
(0.1 / 1 / 5 / 10 / 50 / 100). The native spinner's fixed step of 1 is unusable
on a threshold of 300. Clamp `critical ≥ warning` by construction on change,
rather than relying on a save-time error toast.

### Browser-permission-backed toggles

A switch that depends on a browser permission must reflect the LIVE permission,
not just the stored preference — `DEFAULT_ALERT_SETTINGS.browserNotificationsEnabled`
is `true` while `Notification.permission` is `'default'`, which read as working
while nothing was delivered. Use `lib/health/use-notification-permission.ts`:
effect-only (the app prerenders), synced via
`navigator.permissions.query(...).onchange` with a `visibilitychange`/`focus`
re-read as the Safari fallback. Render four states (unsupported / needs-grant /
granted / blocked); on `denied` disable the switch and explain the unblock, and
NEVER write `false` into storage — that destroys intent and would not come back
when the user unblocks the site. Gate "Send test" on the live permission.

### Tab strips

Define tabs as one array and map it. One icon size (`size-3.5`), no margin
utility — `TabsTrigger` already provides `items-center gap-1.5`; a stacked
`mr-*` is what makes icons look off-baseline. Keep the strip in the
`scrollbar-hide min-w-0 w-full overflow-x-auto` + `TabsList w-max min-w-full
flex-nowrap` wrapper so many tabs (Overview's "Memory & CPU") scroll
inside the strip. `min-w-0 w-full` is required: the strip is a flex child
of `Tabs` (`flex flex-col`), and without a bounded min-width the list
grows to its content (~650px) and "Memo" clips with no in-strip scroll.
Selected state is Base UI `data-active:` (underline via trigger
`border-b-2` + `data-active:border-foreground`), never Radix
`data-[state=active]:` — those selectors never match, so light-mode overview
tabs looked unselected (`data-active:bg-background` on the page surface) while
dark mode still showed the `bg-input/30` pill. Do not rely on `TabsList
variant="line"`'s hanging `after` bar here: the strip is `overflow-x-auto` and
would clip it.

### Responsive chrome (phones + tablets)

- **Overview KPI cards** (`OverviewCharts`) use 1 column, 2×2 from `sm`,
  four-across from `xl`. `md:grid-cols-4` (768) and `lg:grid-cols-4` (1024)
  both crush: at `lg` the 16rem sidebar docks, leaving ~768px for four cards,
  so "Active Queries" wraps. Titles/values wrap from `sm` up; `truncate` is
  `max-sm:` only so a four-up strip at 1280 still shows the full label.
  Clickable cards keep a 44px tap (`min-h-11`).
- **App sidebar overlays below `lg` (1024)**, not `md`. A docked 16rem rail at
  768 / landscape crushes the card grid. `SidebarProvider` uses `useIsLgDown()`;
  the desktop rail + resize handle are `lg:flex` / `lg:block`. The mobile
  sheet is the same 16rem as the desktop rail (`SIDEBAR_WIDTH_MOBILE`), with
  `gap-0` / `p-0` so the default Sheet `gap-4` and `sm:max-w-sm` do not pad
  the drawer. Menu groups use `p-1` (not `px-3 py-2` labels).
- **Mobile sidebar sheet is opaque.** Drawer `bg-sidebar` + `isolate`; overlay
  is a solid dim (`oklch(0 0 0 / 0.55)`), no `backdrop-blur`, so the overview
  heatmap cannot frost through the menu (`styles.css` + sheet classes).
- **Agent FAB** stays `fixed right-4 bottom-4`. Main content gets `pb-16` below
  `lg`; the heatmap's last stat card (`Avg / active day`) is `max-lg:col-span-2
  max-lg:pr-16` so the bubble does not cover the label. On phone landscape the
  FAB moves to `top-16`.
- **Phone tap targets are 44×44** for sidebar rows (`h-11` until `lg`), the
  sidebar trigger (`size-11` until `lg`), and header utility icons — refresh,
  search, theme (`min-h-11 min-w-11` until `lg`). Glyph stays 16–20px. Compact
  sizes return at the desktop rail. The **global header day switcher**
  (1h…30d) is the exception: below `sm` it takes its own full-width second
  header row (`order-last basis-full`, `flex-1` chips, `min-h-9` = 36px) so
  row 1 keeps toggle | title | the 44×44 utilities right-aligned. One `px-3`
  gutter on the header matches `#main-content`. Chart
  `DateRangeSelector` dropdown chips stay `min-h-11 min-w-11` until `sm`.
  **Header page title** (breadcrumb current page) stays fully readable at
  768. Do not `truncate` it — the title cluster is `shrink-0` so sibling
  chrome cannot squeeze "Overview" into "Over…". The header is a two-region
  flex contract: `HeaderIdentity` stays intrinsic-width on the left, while
  `HeaderActionRegion` and `HeaderActions` are `display: contents` on phones
  (their children join the header's wrap), and from `sm` are `ml-auto`,
  `sm:flex-1` with `min-w-0`/`overflow-x-auto` so the controls remain
  right-aligned and swipeable instead of compressing the title. Parent crumbs
  hide until `lg` (overlay-sidebar breakpoint). Header Search is icon-only
  below `lg`; the 160px Search… field is desktop-only. Refresh countdown text
  and the header action gap stay compact until `lg`. Docs article **Copy
  Markdown** / **Open** (`[data-article-actions]`, below `md`) are the same
  44px floor; docs header search/menu is a separate control (`#nd-nav` /
  `#nd-subnav`).

**Touch-safe chart card actions (#3563).** Never hand-write `opacity-0
group-hover:*` on a chart card icon: hover does not exist on touch, so the
action can never be found. Use `chartActionClass({ alwaysVisible?, emphasis? })`
from `components/cards/chart-action-classes.ts` (zoom, CSV export, log scale,
stale indicator, actions menu). Mouse (`pointer-fine:`) keeps the hover-reveal;
touch (`pointer-coarse:`) rests at `opacity-40` and the button grows
`size-6` -> `size-9` (36px). Other small header targets follow the same
`pointer-coarse:` rule (date-range trigger `h-9`, host-switcher row action
`size-9`, time-range segments `min-h-9`). Use `pointer-coarse:` rather than a
width breakpoint: a tablet is wide and still touch.

## UX conventions

- `?host=N` routing; `useHostId()` (`lib/swr`); preserve params via
  `buildUrl(pathname, { host }, searchParams)`.
- Hooks at deepest consumer — no `hostId` prop drilling.
- **Clickable summary card → detail dialog:** make the WHOLE card the target
  (`role="button"` + `tabIndex={0}` + `onClick` + `onKeyDown={activateOnEnterOrSpace(open)}`
  from `lib/a11y.ts` — never a nested `<button>`); inner links call
  `e.stopPropagation()` (NOT `preventDefault`) so they still navigate. Reveal a
  hover/focus "Details" hint. Drive drill-down generically from a per-item field
  (e.g. each health check's `detailChartName`) rendered via `ResultTable`, not
  per-card code — see `components/health/{health-card-shell,health-detail-rows}.tsx`.
- **Insight cards carry ONE severity signal.** `components/insights/severity-meta.ts`
  is the single source of truth (label / icon / `iconColor` / neutral `badge`).
  The severity reads from the **tinted icon only** — no tinted icon tile, no
  colored card border, no colored severity pill, and header count badges stay
  neutral (`border-border bg-transparent text-muted-foreground`). Repeating the
  same signal four times was the "AI slop" the card was redesigned away from
  (2026-08-12). Card body is `line-clamp-2` with the full text as a `title`
  tooltip; the breakdown lives in `InsightDetailDialog`.
- **A dialog opened from a popover must live OUTSIDE the popover subtree.**
  Rendering a `Dialog` inside `PopoverContent` means closing the popover
  unmounts the dialog with it and nothing appears. Keep the selected item +
  dialog in the parent, as a sibling of `<Popover>` (see
  `components/insights/insights-popover.tsx`).
- **Severity-tiered "many checks at a glance":** don't give every item equal
  visual weight. Items that need attention expand to full cards; healthy/normal
  items collapse into ONE dense, quiet bordered list (`divide-y … rounded-xl
  border`) of `[status dot] [muted icon] [title] [sublabel] [value] [chevron]`
  rows — no per-row sparkline (a flat healthy trend is decoration). Partition the
  already severity-sorted, filter-narrowed list into cards vs rows so the same
  split also drives the filter tabs. Keep the aggregate banner restrained: a
  subtle tint plus the colored icon + title carry the severity — NO left accent
  rail (a saturated rail reads as slop; removed 2026-07-05), no saturated fill,
  no count pills (let the tabs carry the counts). Reference:
  `components/health/{health-grid,health-card-shell,health-summary-banner}.tsx`
  (`HealthCardShell` `variant: 'card' | 'row'`).
- Graceful revalidation: keep data on `staleError`, show hover-revealed amber
  `ChartStaleIndicator`; only blank out on initial `error && !hasData`.
- Icons: `lucide-react`, `size-4` / `size-3.5`, `strokeWidth={1.5}`.
- Class idioms: card `rounded-xl border bg-card shadow-sm`; dense text
  `text-[13px]`; meta `text-xs text-muted-foreground`; hero title `text-xl
  font-semibold tracking-tight`.
- **Paired page sections (e.g. AI-generated vs. plain-statistics content):**
  give each section an identical-weight header — `icon (size-4, muted-foreground)
  + <h2 className="text-sm font-medium text-foreground">` — never let one
  section get a bold heading and the other just a bare CTA banner; that reads as
  one being an afterthought. If a section genuinely has no content/settings yet,
  render a labeled placeholder (`EmptyState variant="no-data" compact` inside a
  `Card`) rather than omitting the section. Reference: `/insights` (`AI Insights`
  vs `Cluster Statistics`) and `/insights-settings` (`AI Insights` vs
  `Statistics Insights`, now a real `StatsInsightsSettingsForm`) —
  `components/insights/insights-panel.tsx`,
  `routes/(dashboard)/insights-settings.tsx`.
- **Preview / "Example" surfaces must not depend on live infra or an LLM.** A
  settings-page example, template gallery, or onboarding sample should render
  from deterministic mock data parameterized by the current settings — never a
  live query or model call that shows a scary "Couldn't generate — cluster
  unreachable/read-only" error to an anonymous or read-only visitor. Keep it
  seed-rotated (not `Math.random()`) so it's SSR-safe, and label it (a "Sample"
  badge + a one-line footnote that it's illustrative, not live analysis).
  Reference: `components/insights/insights-preview.tsx` +
  `lib/insights/mock-preview.ts`. Schema Compare (`/schema-diff`) with one
  saved host uses a real `EmptyState` (Add host opens `AddHostDialog`, same
  as HostSwitcher / first-run) plus a faded EXAMPLE of `TableList` +
  `DdlPair` with placeholder names. Two or more peers keep a **static**
  PageHeader (title + recommend-only description) — do not add a dynamic
  "Comparing X → Y — N tables differ" sentence; the pair is the Source /
  Target comboboxes. Toolbar is compact `CompareToolbar` (`p-3` card):
  Connections / Replica nodes tabs (`size="sm"`), then Source / Target
  searchable comboboxes (`ComparePeerSelect`, sorted by name,
  `ChmonitorLogo` + version/uptime/status like HostSwitcher).
  Differences / All and table sort are icon-only controls on the
  table sidebar (with the name search), not the host toolbar.
  Switching Connections / Replica nodes keeps the toolbar and shows a
  listing loading state. Scope toggle (only when both hostCount and
  nodeCount are ≥ 2) writes `?scope=hosts|nodes` and remounts the pair
  from that peer list.
  The table catalog is a collapsible left sidebar grouped
  database → table (`TableList` + `PanelLeftClose` / `PanelLeft`,
  search in the sidebar). Differences-only with zero diffs
  still lists identical tables with a green `CheckCircle2`
  (`--chart-green`); clicking a row selects it on the right. A
  matching table's detail is **All matched** / **This table matches**
  (`MatchOk`) plus side-by-side DDL — never EmptyState "no data" /
  "Select a table" / "No recommended statements". "No tables match"
  is only for a name-filter miss.   Settings Diff (`/settings-diff`)
  with one host keeps the live vs-default matrix and a banner to add
  another host; two or more merged hosts (env + database + browser,
  including negative ids) keep an All-hosts matrix with an optional pair
  mode (`HostPairFilter` + URL `source`/`target`). Host toolbar is
  Connections / Replica nodes + Source/Target only. The listing is the
  shared `DataTable` in embedded mode (one `rounded-xl border bg-card`
  like Running Queries, no second page title). Search, Differences /
  All, Changed from default, Filters, Display options, density, column
  visibility, and CSV live on that table toolbar. Diffs-only with zero
  deltas still lists matching settings; the Match column uses the
  shared boolean check (green) / cross (rose). Empty catalog copy is
  DataTable's "No settings found" / "No settings match your filters"
  (a name or changed-from-default miss). Compare APIs resolve
  merged hosts the same way charts do (`resolve-host-fetch.ts` /
  `use-merged-hosts.ts`).
- Overflow strip: for a single-row scroller that must not wrap, use
  `scrollbar-hide overflow-x-auto` (util in `styles.css`; also on the overview
  tab bar) with `py-*` so card shadows/accents/focus rings aren't clipped
  vertically. When it overflows, show a chevron button + a
  `from-background`→`transparent` edge fade per scrollable side and page with
  `scrollBy({ left: ±clientWidth*0.85, behavior: 'smooth' })`; re-measure on
  scroll, `ResizeObserver`, and content-count change. Reference:
  `components/insights/insights-strip.tsx`.

## Brand

`components/icons/chmonitor-logo.tsx` — orange metric bars + emerald health cap.
Name "chmonitor" / "ClickHouse Monitor". Accents: orange (metrics), emerald
(live/health). For a real upstream brand (PeerDB, …), draw an inline SVG in
`components/icons/` like `peerdb-brand-logo.tsx`. When no real logo is
available/appropriate to fabricate (e.g. third-party LLM providers in the
agent settings Provider & Models tab), fall back to a colored circular
lettermark (first letter, provider's existing accent color) rather than
inventing a low-quality logo — see `ProviderMark` in
`components/agents/settings/provider-models-tab.tsx`.


## Sidebar navigation groups

The dashboard sidebar (and Settings > Navigation, ⌘K, breadcrumbs) is composed
from `apps/dashboard/src/menu/*.ts` via `menu/index.ts` (re-exported as
`src/menu.ts`). Order in `menuItemsConfig` is the sidebar order.

The sidebar is **task groups**, not system-table origins (#3565). It is two
levels deep (group > page); `nav-main/menu-item.tsx` does not recurse, so never
nest a group inside a group. A new page joins one of these groups — do not add
a new top-level heading.

**Main** (in order):
- **Overview** (leaf), then the Postgres leaves (engine-gated, top-level so a
  ClickHouse-family parent cannot drop them on a Postgres host).
- **Queries** — live (Running, User Processes) → history (History, Recent,
  Failed, Query Views Log, Query Metric Log) → performance (Slow, Slow Query
  Patterns, Most Expensive, Query Insights, Thread & Parallelization) → caches.
- **Data & Storage** — tables (Tables, Tables Overview, Data Explorer,
  Dictionaries) → merges & parts → table health (TTL & Partitions, Dropped,
  Readonly, View Refreshes, Index & Projection Analytics) → ingestion (Async
  Inserts, Kafka, RabbitMQ, PeerDB Mirrors / Peers) → storage (Disks, Storage
  Economics, Blob Storage Log, Backups).
- **Cluster & Replication** — Clusters, Fleet Overview, Connections →
  replication (Table Replicas, Replication Queue, Replicated Fetches, DDL
  Queue) → every Keeper page.
- **Server** — metrics (Metrics, Async, Histogram, Profiler) → logs (Text Log,
  Stack Traces, Crashes, Errors, OpenTelemetry Spans) → background work
  (Background Schedule Pool, Workload Scheduling, Warnings, Page Views) →
  access (Users, Roles, RBAC Management, Sessions, Login Attempts, Audit Log).
- **Alerts & Insights** — Insights, Health and Alert, Inbound Events, Traffic.
- **Tools & AI** (last main group) — Chat, SQL Console, Explain, Advisor,
  Chart Builder, Schema Compare, Settings Diff, MCP Server.

**Others**: **Settings** — Agent Settings, Insights Settings, Scheduled Reports,
Health Settings, Alert Settings, then server Settings / MergeTree Settings /
Replicated MergeTree Settings. Configuration pages live here, not in the task
groups.

**Footer**: About (next to the Settings gear; never hidden by a workspace
preset).

### Group quick links (hover a group for pinned + recent pages)

Hovering a top-level sidebar group opens a flyout listing that group's
**Pinned** pages (pin order, from `lib/menu/favorites-store.ts`), then up to 5
**Recent** pages (newest first, never repeating a pinned page), then a footer:
"Open <Group> hub" (only when `getGroupHubHref()` in `lib/menu/group-hub.ts`
returns a route) and "All N pages" (expands the group in place). With nothing
pinned or visited it shows the group's first 3 pages instead.

- Logic is pure and tested in `lib/menu/recent-pages.ts`
  (`recordVisitIn`, `recentInGroup`, `buildGroupQuickLinks`). History is a
  capped (50) localStorage list `chm-recent-pages` of pathnames only; the host
  is re-applied by `HostPrefixedLink`, so links keep `?host=`.
- UI is `components/navigation/nav-main/group-quick-links.tsx`; `menu-item.tsx`
  only mounts `GroupHoverFlyout` around the group trigger and
  `GroupTouchQuickLinks` at the top of the group body.
- Desktop only (`(hover: hover) and (pointer: fine)`): 150ms open delay,
  keyboard focus on the row opens it too, `motion-reduce:animate-none`.
- Touch devices get no flyout; pinned/recent rows sit at the top of the
  expanded group instead.
- The collapsed (icon) rail shows the same Pinned/Recent sections above the
  full page list in `collapsed-submenu.tsx`.

**Permissions on mixed groups.** Only Queries keeps a parent `permission`
(every child is `queries`). The other groups hold pages with different gates,
so the parent has none and **each child sets the `permission` it needs** — a
parent gate would hide pages the deployment allows. Every leaf href appears
exactly once (`menu-config-invariants.test.ts` asserts it, the group order, and
the per-child gates).

**Essential first-run default:** Custom + `DEFAULT_HIDDEN_MENU_HREFS`.
QA keep list is Essential plus `/insights`, `/explorer`, and
`/history-queries`.
Grouped rail (not flattened leaves): Overview (leaf), Queries → Running +
History (`/running-queries`, `/history-queries`), Data & Storage → Tables
Overview + Explorer (`/tables-overview`, `/explorer`), Alerts & Insights →
Insights + Health (`/insights`, `/health`), Tools & AI → Chat + SQL
(`/agents`, `/sql`), More. Cluster & Replication, Server, Settings, and the
extra children stay in the catalog — restore via the group-heading
customize dialog, hover +, More, Settings → Navigation, or in-page More
/ Customize. Do not add a page
to `DEFAULT_VISIBLE_MENU_HREFS` unless it is day-to-day; new specialist
pages are hidden by default because the hide list is the complement of
that keep list. Postgres-only leaves are never auto-hidden.
DBA / Engineer / SRE leftover: those pills still keep whole **groups**,
not Essential-plus-a-few-leaves. `workspace-presets.test.ts` pins every
page each preset showed before #3565 — a regroup may add pages to a preset,
never drop one.

**Hub pages (`/hub/<slug>`).** Queries, Data & Storage, Cluster &
Replication, and Server each have a hub landing page (`/hub/queries`,
`/hub/data-storage`, `/hub/cluster-replication`, `/hub/server`) so any page in
the group is one click away and the key numbers need no click at all.
- **Wiring:** the group row sets `hubHref` (its `href` stays `''` — groups are
  keyed by the empty href everywhere, and a real href would trip the
  parent-path active rule). Each child sets `subgroup` (Queries: Live /
  History / Performance / Caches; Data & Storage: Tables / Merges & Parts /
  Table Health / Ingestion / Storage; Cluster & Replication: Cluster /
  Replication / Keeper; Server: Metrics / Logs & Diagnostics / Background
  Work / Access Control). **A new page in a hub group must set `subgroup`**
  (`lib/menu/__tests__/hub.test.ts` fails otherwise).
- **Page:** `components/hub/hub-page.tsx` renders 3–4 existing registry
  charts (config in `routes/(dashboard)/hub/-hub-charts.ts`; each chart's
  `href` makes its ChartCard title a link and must be a page of the same
  group), then one section per `subgroup` as a 1 → 2 → 3 → 4 column grid of
  link cards (icon, title, menu `description`, `CountBadge` when `countKey`).
  Sections come from `getHubSections` (`lib/menu/hub.ts`) — never keep a
  second page list. Deployment gates (permission, cloud-only, engine) apply
  via `getAllowedMenuItems`. **Hubs follow the Hide settings**: pages the
  user hid (workspace hidden hrefs, or the *Unavailable pages: Hide* setting)
  are left out of the card grids; a subgroup with no cards left is omitted; if
  any were left out one "Show N hidden pages" link at the bottom toggles them
  in place (local state, not persisted), dimmed, with the reason for
  unavailable ones. Unavailable pages that are not hidden stay dimmed with
  their reason. Key charts are unaffected. The rule is the pure
  `filterHubSections` in `lib/menu/hub-visibility.ts` (tested).
- **Sidebar + breadcrumb:** on a hub group the heading label is a link to the
  hub and the chevron is a separate sibling button that still expands
  (`group-expand-button`); groups without a hub keep the whole row as the
  toggle. `getBreadcrumbPath` links the group crumb to the hub and resolves
  the hub URL itself to its group crumb. Every surface reads the hub through
  `getGroupHubHref(groupTitle)` (`lib/menu/group-hub.ts`), which reads the
  group's `hubHref` — never add a second title → hub table.

**Tools & AI** is the interactive-utility group — pages where you *do*
something (ask the agent, run SQL, explain a query, compare hosts, build
charts, expose MCP) rather than watch a system-table monitor. It is the last
Main group in `menu/index.ts`, before the About footer and Settings. It has no
`engines` tag, so a Postgres host hides the whole group. Data Explorer lives
only under **Data & Storage**.
TTL & Partitions (`/ttl-partition-health`) is a system-table inventory
of MergeTree TTL / `PARTITION BY` — it lives under **Data & Storage**, not
Server or Tools & AI. The listing includes a stacked **in-range vs past TTL**
bar (bytes still inside the parsed `INTERVAL` window versus parts whose
`max_date` is older than that window). Same recommend-only heuristics
back the **TTL & Partition Health** card on `/health` (`HEALTH_CHECKS` id
`ttl-partition-health`): a flagged-table count plus a detail-dialog
breakdown. Do not add a third TTL reporting surface. Never `ALTER TTL`
or `DROP PARTITION` from this page. Postgres-only items stay engine-gated
and are not moved here.

⌘K (`components/controls/command-palette.tsx`) indexes the **full**
permission/engine/cloud-allowed catalog (`usePaletteMenuItems` /
`getAllowedMenuItems`), minus the pages this host cannot run. Workspace
`hiddenMenuHrefs` does **not** filter ⌘K — hidden rows stay listed with a
muted Hidden hint; **availability-hidden rows are filtered out** (both rules,
and why they differ, under "Unavailable pages" above). Selecting a
hidden page navigates and does not auto-unhide; the header shows
**Keep in sidebar** (and Pin) on that page. Search still matches
sidebar title, document `<title>` (`lib/page-title.ts` +
OG `headTitle`/`title`), href, description, and optional `keywords` on
`MenuItem` (`menuItemPaletteValue`). Filtering is userland
(`Command shouldFilter={false}` + `filterPaletteRows`): group headings
and Hidden badges are not selectable rows, so Enter/click activate
`navigable[selectedIndex]` (the highlighted href), not the row below.
DBA pages (Advisor, Schema Compare,
Settings Diff, TTL & Partitions) declare aliases so searches like
`ddl`, `schema diff`, `config diff`, `ttl inventory`, or the tab title
`TTL & Partition Health` hit them. The dialog has category tabs
(**All / Pages / Databases / Tables / Actions**, `h-9 px-3` with strip
`px-3 pt-1.5`): Pages is a sidebar-like tree (group heading + one
continuous left rail on the group's item list, not a broken per-row
border); Databases and Tables tabs list the full fetched explorer set
(All still caps at `EXPLORER_GROUP_MAX`). Query tokens highlight in
titles and descriptions (`HighlightText` + `matchRanges`). Row
titles stay one line (`whitespace-nowrap`) so names like
`TTL & Partitions` do not wrap on `&`; descriptions
`truncate` on the same row.

Leave `engines` **absent** on the Tools parent and children. Absent already
means the default source-engine family, so `filterMenuItemsByEngine` drops
the **whole group** on a Postgres host (not an empty heading). Do not add
`engines: ['postgres']`. Settings > Navigation uses the same engine filter
(`useActiveHostEngine` → `getSettingsNavMenuItems(engine)`).

The Tools parent must **not** over-gate children: leave `permission` off the
group and copy each child's existing feature (`tables`, `queries`,
`dashboard`, `settings`) onto the leaf. DBA, Engineer, and SRE presets all
include `Tools` (`PRESET_GROUP_TITLES`); Full auto-includes new groups.

When adding a page: interactive utility → `menu/tools.ts`; system-table view →
the matching domain file (`queries.ts`, `tables.ts`, …).

## File / naming

kebab-case files; PascalCase components; `use*` hooks. The dashboard
declares no client directive. Shared types in `src/types/` or
`src/lib/api/types.ts`; route pages under `src/routes/(dashboard)/`; nav in
`src/menu/` (composed by `menu/index.ts`, re-exported from `src/menu.ts`).
See `conventions.md`.
