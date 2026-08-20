---
name: product-design
description: >-
  chmonitor's product design system + UX conventions, so every new feature looks
  and behaves consistent with the rest of the dashboard. Use BEFORE building or
  reviewing any UI: new pages, charts, cards, dialogs, empty/error/loading
  states, badges, onboarding, settings. Covers design tokens (OKLCH theme, dark
  mode, radius, chart colors), shadcn/ui rules, the ChartCard/ChartContainer
  pattern, data-table system, EmptyState variants, graceful error handling,
  ?host routing + hooks-at-deepest-consumer, file/route organization, and brand.
  Triggers: "new page", "add a chart", "build UI", "design", "component",
  "empty state", "loading", "consistent", "follow-up feature", "match the design",
  "what's new", "changelog", "dialog scroll", "settings gear",
  "schema compare", "settings diff", "add host", "pick a query",
  "query picker", "select labels", "ON CLUSTER", "advisor DDL",
  "command palette", "cmd k", "ttl partitions".
metadata:
  tags: design-system, ui, ux, tailwind, shadcn, charts, tokens, conventions, brand
---

# chmonitor product design system

The rulebook for keeping new features visually + behaviourally consistent. When
in doubt, COPY the closest existing component rather than inventing. Full token
values and file paths: `docs/knowledge/product-design.md`.

## Non-negotiables

1. **Never edit `src/components/ui/*`** (shadcn primitives). Customise via the
   `className` prop at the call site, or a wrapper in `src/components/` — never
   in `ui/`. Always merge classes with `cn()` (`src/lib/utils.ts`), never
   template-literal concatenation.
2. **Tailwind v4, CSS-first.** Tokens live in `src/styles.css` `@theme` blocks —
   there is no `tailwind.config.ts`. Use semantic tokens (`bg-card`,
   `text-muted-foreground`, `border-border`), not raw colors. Theme is OKLCH.
3. **Dark mode is `class`-based** (`next-themes`, `.dark`). Every surface must
   read correctly in both themes — only use semantic tokens, which flip
   automatically. Don't hardcode `bg-white` / `text-black`.
4. **Hooks at the deepest consumer.** A component that needs data calls
   `useHostId()` / `useChartData()` itself — do NOT prop-drill `hostId`.
5. **`?host=N` routing**, never dynamic `/N/...` segments. Preserve other search
   params with `buildUrl(pathname, { host }, searchParams)`.
6. **No "AI slop" decoration** — one clear signal per state, not several
   redundant ones. No full-saturation accent bars/rails stacked on an
   already-colored border; no gradient blobs/glow orbs behind icons. See
   "Anti-patterns" in `docs/knowledge/product-design.md`.

## Tokens (semantic — use these names, not hex/oklch literals)

`background foreground card card-foreground popover muted muted-foreground
primary secondary accent destructive border input ring`. Charts:
`--chart-1..13` for series, plus named accents `--chart-red` (error series),
`--chart-blue` (info), `--chart-green` (success), `--chart-yellow` (warning) —
only pass tokens that exist in `styles.css` to a chart's `colors` prop; an
undefined `var()` renders the series black. Radius: `rounded-md` (9px) default,
`rounded-lg` (10px), `rounded-xl` (14px) for cards. Brand accents: **orange**
(metrics) + **emerald** (health/live) — see `components/icons/chmonitor-logo.tsx`.

## Canonical idioms (match these class strings)

- **Card surface:** `rounded-xl border bg-card shadow-sm` (premium variant adds
  `bg-gradient-to-b from-card/80 to-card/40 dark:from-card/60 dark:to-card/30
  backdrop-blur-xl`). See `components/charts/chart-card-styles.ts`.
- **Icons:** `lucide-react`, `size-4` standard / `size-3.5` compact / `strokeWidth={1.5}`.
- **Dense text:** `text-[13px]` controls, `text-sm` body, `text-xs
  text-muted-foreground` meta, `text-xl font-semibold tracking-tight` page/hero titles.
- **Spacing:** `gap-1.5` compact, `gap-2` standard, `gap-4` generous; card content `p-4 pt-0`.
- **Pill/secondary button link:** `inline-flex h-8 items-center gap-1.5 rounded-md
  border border-border px-3 text-[13px] font-medium hover:bg-muted`.
- **Clickable card → detail dialog:** whole card is the target (`role="button"` +
  `tabIndex={0}` + `onKeyDown={activateOnEnterOrSpace(open)}`, never a nested
  `<button>`); inner links `e.stopPropagation()` (not `preventDefault`) so they
  still navigate. Drive drill-down from a per-item field, rendered via
  `ResultTable`. See `components/health/{health-card-shell,health-detail-rows}.tsx`.
- **One severity signal per card:** severity reads from a single tinted icon —
  never icon tile + colored border + severity pill + header count badge on the
  same finding. `components/insights/severity-meta.ts` is the source of truth
  (label / icon / `iconColor` / neutral `badge`); card surface, border and count
  badges stay neutral. Body `line-clamp-2` + `title` tooltip; the breakdown goes
  in a detail dialog.
- **A dialog opened from a popover lives OUTSIDE the popover subtree.** Rendered
  inside `PopoverContent`, closing the popover unmounts the dialog and nothing
  appears. Keep the selected item + dialog in the parent, as a sibling of
  `<Popover>` — see `components/insights/insights-popover.tsx`.
- **Dialog with sticky header/footer:** `DialogContent` is `flex flex-col
  overflow-hidden p-0` with `max-h-[min(36rem,85vh)]` (or a stable `h-[…]`).
  Header and footer are `shrink-0`. The body is `min-h-0 flex-1 overflow-y-auto`
  — that element is the scroll container. Do not use `ScrollArea` with `flex-1`
  for this: its viewport is `size-full` and does not constrain unless the root
  has an explicit height, so notes paint under the footer and EmptyState can
  vanish inside a blank scrollbar box. Reset `DialogFooter`'s default
  `-mx-4 -mb-4` to `mx-0 mb-0` when the dialog is `p-0`. Same list-scroll
  pattern without a footer: `components/agents/advisor-query-picker.tsx`.
  See `components/whats-new/whats-new-dialog.tsx`.
- **Base UI Select labels:** pass `items={{ value: 'Human label' }}` on
  `Select` (the Root) so `SelectValue` shows the label, not the raw value.
  `placeholder` only appears when nothing is selected — a selected `24` /
  `__all__` otherwise renders as those strings. Same map on compare
  Source/Target (`ComparePeerSelect` — id → `h.name`, never a raw `0`). See
  `components/agents/advisor-query-picker.tsx` and
  `components/compare/compare-peer-select.tsx`.
- **Schema Compare (`/schema-diff`):** one static `PageHeader` ("Schema
  Compare" + recommend-only description). Pair identity lives in the
  Source/Target comboboxes — no second "Comparing X → Y — N tables differ"
  line. Compare tools wrap filters in compact `CompareToolbar`
  (`rounded-xl border bg-card p-3`): tabs on top (**Connections** /
  **Replica nodes**, `SegmentedControl size="sm"`), then Source /
  Target searchable comboboxes (`ComparePeerSelect`: Command +
  Popover, sorted by name, `ChmonitorLogo` plus version/uptime/status
  like HostSwitcher — never a native Select). Copy recommended SQL
  sits on that row (all safe statements, or only tables checked in
  the catalog). Differing tables can be checked to build a sync
  script — recommend-only, never applied. Each table's plan card
  copies that table only. The table catalog is a collapsible left sidebar
  grouped **database → table** (folder row + nested table name).
  Search, **Differences / All** (icon-only `GitCompareArrows` /
  `List`), and sort (icon-only `ArrowDownAZ` menu: A–Z, Z–A,
  differences first) live on that sidebar — not the host toolbar.
  When Differences is on and there are no diffs, still list identical
  tables with a green `CheckCircle2` (`--chart-green`) — click a row
  to select it on the right. Switching Connections / Replica nodes
  keeps the toolbar and shows a listing loading state (not a full-page
  empty load). A matching selection is **All matched** / **This
  table matches** (`MatchOk`), never EmptyState "no data" or
  "Select a table". Keep "No tables match" only for a name-filter
  miss.
  Settings Diff (`/settings-diff`) uses the same host toolbar. The
  listing is the shared `DataTable` (search, Filters, sort, resize,
  drag-to-reorder, density, column visibility, CSV) — name search
  lives there, not next to Source/Target. Diffs-only with zero
  deltas still lists matching settings. The Match column uses the
  shared boolean check (green) / cross (rose); column headers carry
  lucide icons (`CheckCircle2`, `SlidersHorizontal`, `Table2`,
  `Pencil`, `Undo2`, `Server`). "Changed from default" is a
  pressable chip, not a second switch. Empty catalog copy is
  DataTable's "No settings found" / "No settings match your
  filters" — only a name or changed-from-default miss.
- **Sidebar favorites:** the row is a link (`cursor-pointer`). Pin is
  hover-only. Favorites also reveal a grip handle on hover — drag it to
  reorder (`nav-favorites.tsx`).
- **Overflow strip (one row, no wrap):** `scrollbar-hide overflow-x-auto` + `py-*`
  (so shadows/accents/focus rings aren't clipped) with a chevron button + a
  `from-background`→`transparent` edge fade per scrollable side, paging via
  `scrollBy`. Re-measure on scroll / `ResizeObserver` / content-count change.
  Copy `components/insights/insights-strip.tsx`.
- **Agent chat machinery stays ghost-weight.** Reasoning/tool-group triggers
  (`components/assistant-ui/{reasoning,tool-group}.tsx`) are plain
  `icon + label + chevron` text rows — no `bg-muted/50` slab — so the
  assistant's prose stays the loudest element, not two stacked grey cards.
  Tool-call headers show a family icon + short capped summary
  (`summarizeToolOutput` when done, else `summarizeToolInput`), never a raw
  `key=value` param dump; long params (e.g. `sql`) render as a
  syntax-highlighted `CodeBlock` in the "Parameters" disclosure, not inline.
  Running rows use a muted label + tiny spinner. Tool errors render via
  `summarizeToolError` as a compact `border-destructive/30` row with an
  expandable "Details" disclosure — never a raw `{"error":...}` blob. Don't
  add a `.markdown-content`
  `pre`/`code` background rule — Streamdown's own `code:` renderer already
  owns that styling with token-based Tailwind classes; a sitewide override
  paints a second box INSIDE its already-bordered fenced-block card. See
  `docs/knowledge/product-design.md` § "Agent chat: reasoning / tool-call
  rendering".
- **Settings channel grid (configured-first):** a settings surface with many
  optional integrations renders a responsive `grid gap-3 sm:grid-cols-2` of
  collapsible `ChannelCard`s (summary row = icon + name + status + badges +
  enable switch; expanded = the config form) for the channels that are ALREADY
  configured, and compact dashed `AddChannelTile`s (icon + one-line description
  + an example target value) for the rest, which expand into the same card on
  click. Nothing configured → `EmptyState`, never a wall of blank forms. Pin a
  card open once the user edits it so clearing its value can't unmount the input
  mid-keystroke. Unconfigured channels live behind a `ChannelPickerDialog`
  opened from an "Add channel" button in the section header — not a permanent
  inline tile grid. See `components/health/channel-card.tsx` +
  `alert-channels-panel.tsx` (`/alert-settings`).
- **Compact rail sidebar (primary block + collapsible groups):** a narrow
  (~320px) settings rail (e.g. `/agents` right-hand sidebar) keeps its 1-3 most
  important controls (host, model) as a static, never-collapsing "primary"
  block of `LabeledRow`s (small uppercase tag left of the control, one shared
  header, no chevron); everything else is a `CollapsibleSidebarSection`
  (chevron + icon + uppercase label + optional count badge, `ui/collapsible`,
  defaults OPEN so nothing is hidden on first visit). A read-only status row
  explains itself via an info-icon `Tooltip`, not a standing paragraph. See
  `agent-settings-sidebar.tsx`.
- **Settings page shape — few tabs, dialogs for the rest:** at most FOUR tabs;
  rarely-visited panels become a `grid gap-2 sm:grid-cols-2` of launcher cards
  (icon tile + title + one-line description + `ChevronRight`) that open the
  unchanged panel in a `Dialog`. `/alert-settings` went from ten tabs to
  `Alerts · Thresholds · Activity · Advanced` this way. Nothing may become
  unreachable, and every retired `?tab=` id must still resolve — keep a
  `LEGACY_TAB_MAP` to `{ tab, advancedSection? }` so an old link opens the right
  dialog (`advanced-settings-panel.tsx` + `health-settings-panel.tsx`).
- **Presets before forms:** when a surface would render N identical input pairs,
  lead with a named `SegmentedControl` preset covering all of them and show only
  the items tuned away from that baseline; the rest come from a searchable
  picker dialog. Presets scale each item's OWN defaults by a factor
  (`lib/health/threshold-presets.ts`), and "overridden" compares VALUES to the
  defaults, never key presence. A quick-start **template**
  (`lib/health/alert-templates.ts`) may set several at once, but must write only
  into existing stored shapes (whitelist parsers drop unknown fields) and never
  overwrite a target the user typed.
- **Numeric threshold input:** `components/health/threshold-field.tsx` — severity
  dot + label, `−`/`+` steppers around a centered `tabular-nums` input, step
  derived from magnitude. Clamp `critical ≥ warning` on change, not at save.
- **Permission-backed toggles:** a switch gated on a browser permission must
  reflect the LIVE permission, not just the stored preference. Use
  `lib/health/use-notification-permission.ts` (effect-only — the app prerenders;
  `navigator.permissions` `onchange` + a `visibilitychange`/`focus` Safari
  fallback). Four states: unsupported / needs-grant / granted / blocked. On
  `denied` disable the switch and explain the unblock — never write `false` into
  storage. Gate "Send test" on the live permission.
- **Tab strips:** define the tabs as one array and map it — an icon per tab with
  ONE size (`size-3.5`) and NO margin utility; `TabsTrigger` already supplies
  `items-center gap-1.5`. Adding `mr-*` on top of that reads as misalignment.
  Wrap the list in `scrollbar-hide overflow-x-auto` + `w-max min-w-full` so
  labels like "Memory & CPU" scroll instead of clipping. Selected styles use
  Base UI `data-active:` (trigger `border-b-2`, not Radix
  `data-[state=active]:`). Do not use `TabsList variant="line"` on an
  `overflow-x-auto` strip — the hanging `after` underline is clipped.
- **Responsive chrome:** overview KPIs wrap from `sm` (truncate is `max-sm:`
  only). App sidebar overlays below `lg` (not a docked rail at 768). Mobile
  sidebar sheet is opaque — no heatmap-through-frost.   Phone time chips /
  sidebar rows / toggle / header utility icons (refresh, search, theme) are
  `min 44×44`. Docs article Copy Markdown / Open are 44px below `md` (not
  header search/menu). Agent FAB must not cover heatmap
  "Avg / active day" (`pb-16` + last-card `pr-16`; landscape FAB at `top-16`).
- **Paired page sections** (e.g. AI-generated vs. plain-statistics content):
  identical-weight header on both — `icon (size-4, muted-foreground) + <h2
  className="text-sm font-medium text-foreground">`. A *genuinely* empty section
  still gets the header, with an `EmptyState variant="no-data" compact`
  placeholder card, rather than being omitted. See `/insights` and
  `/insights-settings` (`AI Insights` vs `Statistics Insights` — the latter is
  now a real `StatsInsightsSettingsForm`).
- **Preview / "Example" surfaces**: render from deterministic mock data
  parameterized by settings (seed-rotated, SSR-safe), never a live query/LLM
  call — no "Couldn't generate" error for anon/read-only visitors. Label it
  "Sample". See `components/insights/insights-preview.tsx`. Schema Compare with
  one saved host uses a real `EmptyState` (Add host via `AddHostDialog`, same
  as HostSwitcher) plus a faded `TableList` + `DdlPair` example. Settings Diff
  with one host keeps the live vs-default table and a banner (`AddHostButton`,
  `data-testid="add-host"`). Pair ids include user connections. Diffs-only
  with zero deltas still lists matching settings with a green Match check.
- **Base UI primitives** (`components/ui/*` = shadcn Base UI, not Radix): style
  overlays off `data-open`/`data-closed`/`data-orientation` (needs the
  `@custom-variant data-horizontal|vertical` in `styles.css`) and Base UI CSS
  vars (`--anchor-width`, `--available-height`, `--collapsible-panel-height`),
  NOT `data-[state=…]` / `--radix-*`. Use the `render` prop, not `asChild`. Full
  detail in the knowledge doc's "Base UI backing" section.

## Illustrations (bespoke, brand-warm SVGs)

Prefer inline **React SVG** illustration components in
`components/illustrations/` over a lone lucide glyph for high-impact "moments"
and for differentiating states. Rules:

- **Token-driven only** — colours come from `currentColor` (set by a caller
  `text-*` class), the OKLCH chart palette via Tailwind utilities
  (`fill-chart-1`, `text-chart-red`, …), and brand `fill-orange-500` /
  `fill-emerald-500`. NEVER a raw hex/oklch or `hsl(var(--…))` literal (that
  breaks on the OKLCH tokens — see `docs/knowledge/cluster-topology.md`).
- **Motion-safe only** — gate any animation on `motion-safe:` (e.g.
  `motion-safe:animate-flow-stream`, `motion-safe:animate-pulse`), never SMIL;
  add `motion-reduce:animate-none` on pulses.
- **Theme-aware for free** because everything is `currentColor` + semantic
  tokens; verify in both light and dark.
- Structural template: `FlowConnector` in
  `components/connections/connection-help-panel.tsx`.

Current components: `WelcomeIllustration` (first-run welcome hero),
`AgentGreetingIllustration` (agent greeting hero), `EmptyStateIllustration`
(one bespoke ~40×40 mini per `EmptyStateVariant` — wired into `EmptyState`, so
`ChartError` gets a cause-appropriate illustration automatically via
`toEmptyStateVariant`), `BrokenWireIllustration` (connection-error panel: a
browser→chmonitor→source flow with the failed hop severed). Static art for the
marketing/docs sites (which can't import React components) goes in repo-root
`assets/illustrations/` (synced like `screenshots/`/`backgrounds/`).

## Charts — always wrap state, never hand-roll it

Use `ChartContainer` (renders skeleton / `ChartError` / empty) + `ChartCard`
(title, SQL, metadata, stale indicator, retry). Fetch with `useChartData({
chartName, hostId, interval })`. Header icon order:
`[StaleIndicator] [DateRange] [LogScaleToggle] [CardToolbar]`. Copy an existing
chart in `components/charts/` as the template — don't reinvent the wiring.

## Loading / empty / error

- **Loading:** a `Skeleton` that matches the final layout (`components/skeletons/`)
  to avoid layout shift; gate with `Suspense` where used.
- **Empty:** `EmptyState` (`components/ui/empty-state.tsx`) with the right
  `variant` (`no-data | no-results | error | table-missing | timeout |
  filtered-empty | offline | loading`), `icon`, `title`, `description`, optional
  `action`/`onRefresh`. Table query failures use the full (non-compact)
  EmptyState so timeout / missing-column copy is visible — never hourglass +
  Retry with no description.
- **Interactive tool pages** (Explain, Advisor): before the first run, a
  dashed-border `EmptyState variant="no-data"` ("Nothing to analyze/explain
  yet"). User-input issues — table-less SQL like `SELECT 1`, missing
  `query_id` — use the same EmptyState with next steps, never `ErrorAlert`
  titled "Analysis failed". `ErrorAlert` is for host/schema/fetch failures.
  Picking a query from the picker auto-runs, same as `/explain`.
- **Recommend-only DDL pairs:** when cluster topology is known (Distributed
  engine or cluster metadata), Advisor findings and schema-diff plan items
  show the local table name plus a copyable `ON CLUSTER` variant of the same
  statement via `RecommendDdlBlocks` (`components/ddl/recommend-ddl-blocks.tsx`).
  Single-node / no topology stays a single statement. Never a Run/apply
  button — `lib/ddl/on-cluster.ts` is a pure transform.
- **Error (graceful):** initial error (`error && !hasData`) → full `ChartError`
  with retry. Revalidation error (`staleError`) → KEEP showing data + subtle
  amber `ChartStaleIndicator` (hover-revealed), auto-clears on next success.
  Never blank out good data on a refresh failure.
- **First run (zero hosts):** `FirstRunGate` → `FirstRunEmptyState` (3 modes:
  cloud signed-in / cloud anon / self-hosted). See the `cloud-saas-mode` skill.

## Data tables

Use the `components/data-table/` system (resizing, wrap toggle, sorting via
`sorting-fns.ts`, pagination, faceted filters, row actions, SQL display).
Synthetic column ids `__expand`, `select`, `action` are non-data — skip them in
filter/search/sort/card wiring.

Favorites in the sidebar can be drag-reordered; order is the localStorage pin
list (`chm-pinned-favorites`). Leaf sidebar rows also reveal Hide (EyeOff)
beside the pin; that writes `hiddenMenuHrefs` and toasts Undo + Open
Navigation (Settings → Workspace → Navigation).

## User appearance settings

**Entry:** sidebar footer chrome beside Sign In / the avatar —
`[what's new] [gear] [Sign In / avatar]` with `flex items-center gap-1.5`.
What's new is `WhatsNewButton` (`components/whats-new/`, lucide `Newspaper`,
`aria-label="What's new"`, `data-testid="whats-new-button"`, 44px mobile hit
`min-h-11 min-w-11 lg:min-h-8`). A primary **dot** badge appears when
`APP_VERSION` is newer than persisted `lastSeenChangelogVersion` (on
`UserSettings`). The dialog (`WhatsNewDialog`, sibling of the menu via
`WhatsNewProvider` in `dashboard-shell.tsx`) lists `vX.Y.Z` GitHub Releases
newest first; auto-opens **once** per upgrade (sessionStorage), never on every
navigation. Header and footer stay put; only the notes body
(`min-h-0 flex-1 overflow-y-auto`) scrolls — see the sticky header/footer
dialog idiom above. Manual open always works. Extra entry points: `WhatsNewMenuItem`
next to About in the user dropdown, and a What's new action on `/about`. Do
**not** add a Settings tab for changelog — Settings stays browser-local prefs.
`GET /api/v1/releases` loads notes server-side (no browser GitHub calls).
Copy comes from `docs/whats-new/vX.Y.Z.md` when present (same files as landing
`/changelog`); otherwise the GitHub body is stripped to Features. Airgap
fallback is the committed `airgap-snapshot.json` (friendly notes overlaid on
latest `v*` Features), never a runtime fetch of CHANGELOG.md. Use `NavSettingsButton` /
`NavUserFooterRow` (`components/nav-user/nav-settings-button.tsx`): lucide
`Settings`, `size-4`, `strokeWidth={1.5}`, `aria-label="Open settings"`,
`data-testid="nav-settings-button"`, tooltip "Settings". Hide when
`canUseSettings` is false. Gear must work signed-out (these are local settings).
Keep the dialog a **sibling** of the menu (not inside `DropdownMenu` /
`SignInButton`). ⌘, still opens it (`useSettingsShortcut`). Do **not** invent a
second settings store — always `SettingsDialog` + `useUserSettings`.

The Settings dialog (`components/settings/settings-form.tsx`) exposes units
(`byteUnit`, `numberFormat`), chart palette (`chartPalette`), table density
(`tableDensity`), default time range, and workspace preset
(`workspacePreset`, `hiddenMenuHrefs`) on `UserSettings`. Header is Settings
icon + title + one-line "Local to this browser"; surface is
`rounded-xl border bg-card p-0` with a **stable height** (`h-[min(36rem,85vh)]`)
and `select-text` so labels copy. Left rail is a flat column (no boxed
tab well): section labels + icon rows, selected = muted pill, `border-r`
divider. Content pane shows the active tab title. Theme (Light / Dark /
System) is a settings row (label left, three window thumbnails right)
on Appearance only. Navigation leads with a `SegmentedControl` workspace
preset (Full / DBA / Engineer / SRE / Custom) plus an in-page sidebar-like
menu tree (same groups, icons, nested children as `nav-main`). Groups
default collapsed; picking a role remounts them closed. Parent rows are
chevron-only. Nested children use `SidebarMenuSubButton` (`text-left`,
same as the parent button) so a `<button>` row is not UA-centered; Hide
stays `shrink-0` on the right. Click a leaf to hide or show it — hidden
rows stay visible but muted, like Dim unavailable pages.
Expand/collapse does not write settings. Hide of an already-hidden-by-
preset leaf stays on the role; Custom only when the hide list leaves
`hideListForPreset`. Search filters the tree. Never a 40-checkbox wall
or a separate Hide-pages drawer. Then the Dim / Hide unavailable-page
demos.
Hidden pages stay routable. Filter through
`getVisibleMenuItems` so sidebar, ⌘K, and the Settings > Navigation
tree match the **active host engine** (`useActiveHostEngine` —
default source engine, Postgres pages when `?pg=` is active).
Timezone uses `timezone-combobox.tsx`
(search + browser zone on top). Palette is a card picker with mini bars, not
a segmented control. Unit options show a sample value (`1.5 GiB` / `1.6 GB`).
Integrations: MCP live; Slack/Telegram/PagerDuty/Email/Discord shown disabled.
Every DEFAULT reproduces the prior look byte-for-byte (`workspacePreset:
'full'`). Applied by
`AppearanceSettingsProvider` (`lib/context/appearance-settings.tsx`): units →
module snapshot in `lib/format-settings.ts`; palette/density →
`data-chart-palette` / `data-density` on `<html>`. For 2–3 choices use
`components/settings/segmented-control.tsx`. Full detail:
`docs/knowledge/product-design.md`.

## Adding a page

1. `src/routes/(dashboard)/my-page.tsx` (`'use client'`, uses `useHostId()`).
2. Add a `QueryConfig` in `src/lib/query-config/` if it needs data.
3. Register in `src/menu/` (with feature gate / `tableCheck` if optional).
   Add the tab title in `lib/page-title.ts` (`ROUTE_TITLE_MAP`) when it
   differs from title-casing the last URL segment — ⌘K searches that
   `<title>` as well as the sidebar label.
   Interactive utilities (SQL, explorer, explain, compare, builder, advisor)
   go in `menu/tools.ts`. Data Explorer (`/explorer`) is also listed under
   Tables. TTL & Partitions (`/ttl-partition-health`) is a system-table
   inventory — it lives under Tables, not Tools or System. The same
   recommend-only rules also power the **TTL & Partition Health** card
   on `/health` (flagged-table count + detail dialog). Do not invent a
   third TTL surface; wire new reporting through those two. Other
   system-table views stay in their domain file. Tools is the last Main group, composed
   after Logs and before the About footer in `menu/index.ts` — do not put
   it after Overview / before AI Agent. The Tools parent must not set
   `permission`; copy the child's existing feature onto the leaf. Leave
   `engines` absent so Postgres hosts hide the whole Tools group — do not
   add `engines: ['postgres']`. DBA / Engineer / SRE presets include
   `Tools`. Webhook ingest (Inbound Events) lives under Health after
   Alert Settings — not as a top-level Others item; leave `engines`
   absent so Postgres hosts inherit Health (default source-engine family).
4. Compose `ChartContainer` + `ChartCard`; reuse skeletons + empty/error states.

## File & naming conventions

kebab-case files; PascalCase components; `use*` camelCase hooks; props as
`interface XProps` colocated; client components declare `'use client'`, server
components don't; shared types in `src/types/` or `src/lib/api/types.ts`. Details
in `docs/knowledge/conventions.md`.

## Keep this skill current

This skill is the source of truth for design consistency. When you introduce or
change a durable UI pattern (a new token, a reusable component, an
empty/error/onboarding convention), UPDATE this file + `docs/knowledge/
product-design.md` in the SAME change. See the "Auto-improve project skills"
note in the root `CLAUDE.md`.
