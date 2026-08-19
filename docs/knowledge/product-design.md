---
id: product-design
title: Product design system & UX conventions
type: reference
status: active
updated: 2026-08-19
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
Notes come from `GET /api/v1/releases` (server-side GitHub Releases; airgap
fallback is a **build-time snapshot** of latest `v*` Features, not
the full CHANGELOG.md). Settings icon is lucide `Settings` (`size-4`, `strokeWidth={1.5}`),
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
(`h-[min(36rem,85vh)]`) so tabs do not resize the panel, and `select-text`
so labels copy. Layout is `p-0`: a flat left rail (section labels
Preferences / Display / Workspace, icon + label rows, selected as a muted
pill, `border-r`) and a content pane whose heading is the active tab.
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
`segmented-control.tsx` (optional `description`). Dialog keeps
`data-testid="settings-dialog"`.

**Invariant: every default reproduces the prior behaviour byte-for-byte** —
`byteUnit: 'binary'`, `numberFormat: 'abbreviated'`, `chartPalette: 'default'`
(attribute absent), `tableDensity: 'comfortable'` (attribute absent),
`defaultTimeRange: '24h'`, `workspacePreset: 'full'`, `hiddenMenuHrefs: []`.

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
wrapper in `src/components/`. Merge with `cn()` (`src/lib/utils.ts` = clsx +
tailwind-merge). Primitives available: accordion, alert, avatar, badge,
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
  (`lib/swr/use-chart-data.ts`). Card styles centralised in
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
  handle on hover; drag it to reorder (`nav-favorites.tsx`). Order is the
  `chm-pinned-favorites` localStorage pin list (`lib/menu/favorites-store.ts`).
  Leaf rows also reveal Hide (EyeOff) beside the pin; that writes
  `hiddenMenuHrefs` via `hideMenuHref` and toasts Undo + Open Navigation
  (Settings → Workspace → Navigation). Footer About is not hideable this way.

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
  directly, matching `agent-data-sources.tsx`). Defaults to **open** so first
  visits show everything; collapsing only hides a section, it never removes a
  control or entry point.
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

**Nothing may become unreachable, and no deep link may die.** Keep a
`LEGACY_TAB_MAP` from every retired `?tab=` id to `{ tab, advancedSection? }`,
so an old link lands on the right tab with the right dialog already open
(`health-settings-panel.tsx`).

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
`scrollbar-hide overflow-x-auto` + `TabsList w-max min-w-full flex-nowrap`
wrapper so many tabs (Overview's "Memory & CPU") scroll instead of clipping.

### Responsive chrome (phones + tablets)

- **Overview KPI cards** wrap titles/values from `sm` up. `truncate` is
  `max-sm:` only — a four-up strip at 1280 must show "Active Queries" and
  typical values in full.
- **App sidebar overlays below `lg` (1024)**, not `md`. A docked 16rem rail at
  768 / landscape crushes the card grid. `SidebarProvider` uses `useIsLgDown()`;
  the desktop rail + resize handle are `lg:flex` / `lg:block`.
- **Mobile sidebar sheet is opaque.** Drawer `bg-sidebar` + `isolate`; overlay
  is a solid dim (`oklch(0 0 0 / 0.55)`), no `backdrop-blur`, so the overview
  heatmap cannot frost through the menu (`styles.css` + sheet classes).
- **Agent FAB** stays `fixed right-4 bottom-4`. Main content gets `pb-16` below
  `lg`; the heatmap's last stat card (`Avg / active day`) is `max-lg:col-span-2
  max-lg:pr-16` so the bubble does not cover the label. On phone landscape the
  FAB moves to `top-16`.
- **Phone tap targets are 44×44.** Time chips (`min-h-11 min-w-11` until
  `sm`), sidebar rows (`h-11` until `lg`), sidebar trigger (`size-11` until
  `lg`), header utility icons — refresh, search, theme (`min-h-11 min-w-11`
  until `lg`). Glyph stays 16–20px. Compact sizes return at the desktop rail.
  Docs article **Copy Markdown** / **Open** (`[data-article-actions]`, below
  `md`) are the same 44px floor; docs header search/menu is a separate control
  (`#nd-nav` / `#nd-subnav`).

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
  `DdlPair` with placeholder names. Settings Diff (`/settings-diff`) with one
  host keeps the live vs-default matrix and a banner to add another host;
  two or more merged hosts (env + database + browser, including negative
  ids) keep an All-hosts matrix with an optional pair mode (`HostPairFilter`
  + URL `source`/`target`). Compare APIs resolve merged hosts the same way
  charts do (`resolve-host-fetch.ts` / `use-merged-hosts.ts`).
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

**Main**: Overview, Postgres (engine-gated), AI Agent, Insights, Health
(Health, Health Settings, Alert Settings, Inbound Events), Queries, Tables,
Merges, Metrics, Keeper, PeerDB, **Tools** (last main group).

**Others**: Security, Logs, System, Cluster, Operations.

**Footer**: About (next to the Settings gear; never hidden by a workspace
preset).

**Tools** is the interactive-utility group — pages where you *do* something
(run SQL, explore schema, explain a query, compare hosts, build charts) rather
than watch a system-table monitor. It is the last Main group: composed after
Logs in `menu/index.ts`, before the About footer and System / Cluster /
Operations. Current leaves, most-used first: SQL Console (`/sql`), Data
Explorer (`/explorer`), Explain (`/explain`), Advisor (`/advisor`,
recommend-only), Chart Builder (`/dashboard`), Schema Compare
(`/schema-diff`), Settings Diff (`/settings-diff`). AI Agent stays its own
flagship group. Postgres-only items stay engine-gated and are not moved here.

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

kebab-case files; PascalCase components; `use*` hooks; `'use client'` on
interactive client components; shared types in `src/types/` or
`src/lib/api/types.ts`; route pages under `src/routes/(dashboard)/`; nav in
`src/menu/` (composed by `menu/index.ts`, re-exported from `src/menu.ts`).
See `conventions.md`.
