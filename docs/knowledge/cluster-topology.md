---
id: cluster-topology
title: Cluster Topology Visualization
type: spec
status: active
updated: 2026-09-27
tags:
  - cluster-topology
  - svg
  - layout
  - geometry
  - oklch
  - shared-component
  - dynamic-viewbox
related:
  - conventions
  - static-site-architecture
  - query-config-format
---

# Cluster Topology Visualization

The SVG graph on `/clusters` (and the **Cluster Topology** tab on `/overview`) that
draws ClickHouse nodes, the Keeper quorum, cluster territories, and the edges
between them from **real** `system.clusters` + Keeper data.

> **Why this doc exists:** the layout is a chain of pure functions tuned with many
> interdependent numbers. The numbers are not arbitrary — each encodes a geometric
> relationship, and several form **cross-file contracts** (change one side, you must
> change the other). This note is the single place those contracts are written down.
> Read it before touching `model.ts` (or its siblings below) / `topo-glyphs.tsx` /
> `topo-canvas.tsx`. **None of the cross-file contracts below are currently enforced by a
> test** — see "Test invariants".

## File map

All component paths below are relative to
**`apps/dashboard/src/components/cluster-topology/`** (the `src/` segment was
added by the TanStack Start promotion; the pre-#1613 location was
`apps/dashboard/components/cluster-topology/`).

`model.ts` used to hold the whole pipeline in one 1500-line file; it now re-exports
from **six** siblings (`model-types`, `model-constants`, `model-parse`,
`model-assemble`, `model-layout`, `model-hulls`) so every existing
`import { ... } from './model'` keeps working unmodified — split for
maintainability only, not a public-API change.

| File | Responsibility |
|------|----------------|
| `index.ts` | Package barrel: re-exports `TopologyView` only. |
| `components/cluster-topology/model.ts` | Types (`TopologyData`, `TopologyModel`, `ChNode`, `KeeperNode`, `ClusterHull`, …) + `export *` from the six siblings below — the public entry point, table of contents. |
| `components/cluster-topology/model-types.ts` | The type declarations themselves (the leaf of the six-sibling split); imported directly by `topo-canvas-geometry.ts`. |
| `components/cluster-topology/model-constants.ts` | Layout constants, geometry envelopes (`CH_R`/`KP_R`, `*Extent` functions), `STATUS_COLOR`, `CLUSTER_PALETTE`. |
| `components/cluster-topology/model-parse.ts` | Row coercion (`num`, `numOrNull`, `truthy`) + node-identity heuristics (`shortId`, `isLoopbackAddr`, `nameScore`, `isPhysicalName`, `isReplicatedDbRow`, `isKeeperNode`). |
| `components/cluster-topology/model-assemble.ts` | `assembleTopology`: raw ClickHouse rows → layout-free `TopologyData` (host merge, cluster/keeper assembly, edges). |
| `components/cluster-topology/model-layout.ts` | `layoutTopology` / `buildTopologyModel` + node placement (`layoutKeepers`, `layoutChNodes`, `fitContent`, `enforceMinDistance`, …). |
| `components/cluster-topology/model-hulls.ts` | Cluster territory + keeper-region overlay geometry (`buildClusterHulls`, `buildKeeperRect`, `nudgeLabels`). |
| `components/cluster-topology/geometry.ts` | Pure path math: `roundedRectPath`, `offsetHullPath` (legacy), `convexHull`. |
| `components/cluster-topology/topo-canvas-geometry.ts` | Pure geometry for the canvas, zero React deps: `contentViewBox`, `clientToSvg`, `cageForNode`, `clampToHull`, `groupSafeDelta` + drag/position types. Imports from `model-types`/`model-constants`/`model-parse` directly, never `./model` or a component file, so it can't reintroduce the barrel import cycle. Unit-tested in `topo-canvas-geometry.test.ts`. |
| `components/cluster-topology/topo-glyphs.tsx` | **The glyph + label layer**, extracted out of `topo-canvas.tsx`: `ChGlyph`, `KeeperGlyph`, `HullLabel`, `hexPath`, `curvePath`, plus the module-private `ChLogo`, `NodeLabel` and `truncateMiddle`. This is the file that actually paints every label offset the extent contract depends on (see below). |
| `components/cluster-topology/topo-canvas.tsx` | The SVG render and drag pointer handlers (consumes `topo-canvas-geometry.ts`, and imports `ChGlyph`/`KeeperGlyph`/`HullLabel`/`curvePath` from `./topo-glyphs`). |
| `components/cluster-topology/topology-view.tsx` | Wrapper: status strip, pills, legend, **canvas container**, inspector. Accepts `detailHref`. |
| `components/cluster-topology/inspector.tsx` | Right-hand detail panel (per-node / cluster overview). |
| `components/cluster-topology/use-topology.ts` | TanStack Query hook (`useQuery`) → `/api/v1/cluster-topology`. Structure cached hard (60s) vs. the per-node live snapshot. |
| `components/cluster-topology/topology-select.test.ts` | Locks `useOnClearSelect` identity (React.memo must not be defeated by a fresh closure). Needs `react` + `happy-dom`, so it needs an installed tree — unlike the geometry test. |
| `components/cluster-topology/topo-canvas-geometry.test.ts` | Locks `clampToHull` + `clientToSvg` (8 pure tests, no React). |
| `src/routes/api/v1/cluster-topology.ts` | Server route: assembles the layout-free `TopologyData`. |

## Layout pipeline (pure, deterministic)

`assembleTopology(rows…)` → `TopologyData` (no x/y; the server wire shape)
→ `layoutTopology(data)` adds x/y + hulls → `TopologyModel` (what the canvas renders).

Inside `layoutTopology`, in order:

1. `layoutKeepers` — keeper quorum near the top (single centered; multi = leader apex + follower row).
2. `layoutChNodes` — group CH nodes by **logical**-cluster membership signature; place each
   group at the average of its clusters' centroids (a node shared by 2 clusters lands in the
   lens between them). `fanOut` spreads a group on a wide, zigzag-staggered grid.
3. `enforceMinDistance` — iterative repulsion so glyphs + labels never collide.
4. `clampToBand` — keep CH nodes inside the readable band.
5. **`fitContent`** — center the composition horizontally in `VB_W` and compute a **data-driven
   `vbHeight`** that fits the content (keeper region + CH band + the deepest ring outset + bottom
   pills, via `boundaryReserve`'s `padTop`/`padBottom`), floored at `VB_H`, then center vertically
   within it. This is the "auto layout": no-keeper / sparse / dense graphs all self-fit; the
   returned height flows out as `model.vbHeight`.
6. `buildClusterHulls` + `buildKeeperRect` — territory rectangles from member positions.
   `buildClusterHulls` clamps each rect's top to the keeper ceiling (`KEEPER_CLUSTER_GAP`) and
   receives only the VISIBLE clusters (physical dropped when `showPhysical` is false).

**Determinism is mandatory.** No `Math.random` / `Date.now` (would break the query-cache-stable
layout and the determinism invariant). Per-cluster size jitter uses a stable string hash (`hashStr`).

## The constants — and the contracts between them

Mostly in `model-constants.ts` (re-exported from `model.ts`) unless noted — the two
hull constants `NEST_STEP` (30) and `KEEPER_CLUSTER_GAP` (16) live in `model-hulls.ts`
next to the code that uses them. **Do not change a number in isolation; check the contract.**

| Constant | Meaning | Contract / why |
|----------|---------|----------------|
| `VB_W` | viewBox width (1280) | Fixed. Wide aspect so the graph fills the xl two-column container. |
| `VB_H` | **MINIMUM** viewBox height (560) | The ACTUAL height is **data-driven** (`model.vbHeight`, computed in `fitContent`): it grows to fit the keeper region, the keeper↔CH gap, and the deepest cluster-ring nesting + bottom pills for THIS model, floored at `VB_H`. A sparse graph stays compact (big glyphs); a deeply-nested one grows taller and letterboxes (`preserveAspectRatio="meet"`). **The canvas reads `model.vbHeight`, NOT `VB_H`.** Layout tests bound node `y` by `model.vbHeight`. |
| `KEEPER_CLUSTER_GAP` | min gap below the keeper region (16) | `buildClusterHulls` clamps every cluster rect's TOP edge to `max(keeperBottom)+gap` so the outermost concentric ring can never climb into the keeper region — a keeper (a non-member) always stays OUTSIDE the CH cluster boxes. Guarded by the cluster's content-top so it only trims the decorative outset band, never a node's own box. |
| `CH_R` `KP_R` | node radii (42 / 40) | **Exported & imported by `topo-glyphs.tsx`** (via the `./model` barrel) so the drawn glyph == the size layout reserves. Single source of truth — never redeclare in the glyph layer. |
| `chHalfExtent / chUpExtent / chDownExtent` | CH node CONTENT envelope (glyph + labels) | **CONTRACT with `topo-glyphs.tsx` label positions.** `chDownExtent` must cover the sub-line / host line / LOCAL badge the glyph layer paints (see `NodeLabel` + the LOCAL badge `r + …`). If you move a label there, update the matching extent here or it spills outside its cluster boundary. |
| `keeperHalf/Up/DownExtent` | Keeper envelope | Same contract with the keeper glyph (`star` above → bigger up-extent for leaders). `keeperDownExtent(k)` is **node-aware**: when the keeper host is an FQDN (`host !== id`), `NodeLabel` paints a host line AT `r+16` **and** a sub-line at `r+31`, so the extent is `KP_R + 42` (vs `KP_R + 26` for short hosts). Get this wrong and follower labels spill below the green boundary into the cluster region. |
| `ENVELOPE_MARGIN` | breathing room between content and a boundary (12) | Applied in `buildClusterHulls` + `buildKeeperRect`. |
| `boundaryReserve(...) → fitContent padTop/padBottom` | room the rings + bottom pills need beyond the node envelopes | `fitContent` only knows node envelopes; the rects outset past them (`ENVELOPE_MARGIN` + concentric `NEST_STEP`) and pills sit on the bottom edge. `boundaryReserve` derives a top/bottom pad from the deepest coincident nest among the cluster set it receives (visible clusters — physical included only when `showPhysical: true`) so a densely-nested graph stays in view. |
| `CLUSTER_RECT_RADIUS` | corner radius of territory rects | Capped to half the shorter side in `roundedRectPath`. |
| `enforceMinDistance(... CH_R*2 + 92)` | min node gap | Sized so a **single-node** cluster boundary (≈ `CH_R + chHalfExtent + margin`) cannot reach a neighbor glyph. If you shrink this, boundaries start cutting neighbors. |
| `CH_BAND_Y/H`, `CH_MARGIN` | the CH region rectangle | Relative placement only — `fitContent` re-centers afterward, so exact values matter less than the keeper↔CH gap. |
| keeper pill `y` (canvas) | `max(13, min(keeperY) − KP_R − 32)` | Tracks the region top and clears the leader ★. Recomputed from live keeper positions — not a fixed y. |

### The #1 maintenance hazard: envelope ↔ label positions

`buildClusterHulls` draws each territory as the bounding box of its members' **content
envelopes**, so nodes *and their labels* sit inside the boundary. The envelope numbers in
`model-constants.ts` (`chDownExtent` etc.) are derived from where **`topo-glyphs.tsx`**
actually paints the labels (`NodeLabel`'s `r + 16` / `r + 31`, the LOCAL badge's
`r + 25`/`r + 40` — `topo-glyphs.tsx:116`/`:122`/`:339`). These are two
files that **must agree**. When editing either:

- Changed a label offset/size in the glyph layer? → update the matching `*Extent` in
  `model-constants.ts`.
- Verify with the harness (below) that no label pokes outside its cluster rect.

The pairing is asserted nowhere — there is no test, and no lint rule. This is the
single most expensive mistake available in this component.

## OKLCH gotcha (critical, repo-wide)

The theme tokens are **OKLCH** (`--card: oklch(1 0 0)`), so the old shadcn-era SVG idiom
`hsl(var(--card))` evaluates to `hsl(oklch(…))` — **invalid CSS → black fill**. This is what
made the original nodes render black. **In SVG, reference tokens bare: `fill="var(--card)"`** and
express alpha via `fill-opacity` / `stroke-opacity` (or `oklch(from var(--x) l c h / a)`).
Tailwind utilities (`bg-card`) are fine because they emit `var(--card)` directly.

> Same latent bug still exists in `explorer/sql-editor.tsx`, `explorer/dependency-graph`, and
> `peerdb/mirror-phase-timeline.tsx` — a worthwhile follow-up, out of scope for the topology PR.

## Visual elements

- **ClickHouse node** = rounded-square server card carrying the **official ClickHouse logo**
  (4 yellow bars + a red foot, native 9×8 grid, `ChLogo`), node id inside, a live CPU meter on
  the lower edge, status dot at the corner. Unreachable → dashed slate border + grayed logo + dimmed.
- **Keeper node** = hexagon (`hexPath`). Leader = gold border + ★. Distinct silhouette from CH on purpose.
- **Cluster territory** = rounded **rectangle** (not a blob): simple, predictable, and two
  overlapping rects read as a clean lens. EVERY cluster (logical AND physical) gets its own
  palette color + a soft fill + a solid-bordered label pill (`HullLabel`) — physical clusters
  read a touch softer (lower fill/stroke opacity), not a flat gray. Each colored boundary is
  drawn over a **card-colored casing** (a slightly wider stroke beneath it) so crossing / nested
  boundaries don't tangle at their intersections. A small expand-only `hashStr` jitter offsets
  distinct overlapping rects so their edges aren't collinear.
- **Physical/implicit clusters** (`all-replicated`, `all-sharded`, `default` — see `isPhysicalName`)
  are **hidden by default**. A legend eye-toggle (`showPhysical`, lifted in `TopologyView`, passed
  to `layoutTopology({ showPhysical })`) reveals them. Hiding them drops their hulls AND their
  height reserve (they are the outermost rings), so the viewBox shrinks; node positions are
  logical-cluster-driven so they never move when toggling.
- **Keeper region** = its own rounded rect (`buildKeeperRect`), dashed green, with the
  "Keeper quorum · Raft" pill. (Earlier it was an offset hull; switched to a rect for label
  enclosure + consistency — the geometry test was updated to match.)
- **Edges** = gentle quadratic-bezier curves (`curvePath`), never straight lines: blue =
  replication, dashed muted = coordination (CH↔leader), green = raft (keeper mesh).
- **Current node** = the connected (`is_local`) ClickHouse card carries a persistent breathing
  primary ring (`.topo-current-ring`, keyframe `topo-current-breathe` in
  `apps/dashboard/src/styles.css` — the dashboard has no `globals.css`; honoring
  `prefers-reduced-motion`) — always visible, independent of selection. The class is applied
  in `topo-glyphs.tsx`, not `topo-canvas.tsx`.

## Node identity merge (de-dupe the local server)

`system.clusters` is evaluated on the ONE server you queried, so **every row with `is_local = 1`
is that same physical machine** — even when listed under different `host_name`s across clusters
(the implicit `default` cluster lists `localhost`; the operator cluster lists the pod FQDN
`chi-...-0-0`). `assembleTopology` runs a small **union-find** so they collapse to ONE node
(otherwise the local server is drawn twice, e.g. `localhost` AND `chi-...-0-0`):

- **(a)** all `is_local` keys → one node (definitive — same queried server);
- **(b)** rows sharing a **routable** `host_address:port` → one node (a hostname-vs-IP duplicate of
  a *remote* node; loopback `127.*`/`::1`/`localhost` excluded so distinct remotes don't merge).

The merged node keeps the most descriptive name (`nameScore`: a real FQDN beats `localhost`), unions
its host_name/address **aliases** for live-metric matching, and `is_local`/errors are OR'd/summed.
The merged node then belongs to *both* clusters → it correctly sits inside both territories.
**Not currently test-locked** — the `model.test.ts` "local-duplicate merge" case was
deleted with the Next.js app in #1613 and never replaced. Treat the union-find as
unguarded: if you touch `assembleTopology`, re-check it by hand or restore a test.

## Label legibility (overlap, FQDNs, coincident clusters)

- **Long host labels** are middle-truncated in `topo-glyphs.tsx` (`truncateMiddle`, ~24 chars ≈
  `chHalfExtent`) with the full host on hover (a `<title>`) — a 60-char FQDN otherwise blows past
  its cluster boundary. Truncation length is the horizontal half of the envelope contract.
- **Coincident clusters** (same member SET — the implicit `all-*`/`default` clusters all covering
  the same hosts) are drawn as **concentric nested rects** in distinct palette colors:
  `buildClusterHulls` ranks each cluster within its member-set signature and outsets ring `k` by
  `k * NEST_STEP` (30 — wide enough that each colored ring + its casing has clear air, so adjacent
  borders never overlap). Distinct-but-overlapping clusters keep the small `hashStr` jitter instead.
- **Cluster label pills** anchor to each rect's **BOTTOM** edge (`labelY = maxY`), not the top: the
  top edge sits in the crowded zone just under the keeper region where pills got hidden or overlapped
  node sub-lines; below the cards is open space. `nudgeLabels` de-overlaps width-aware
  (`name.length*7+20`, matching `HullLabel`) by stacking **downward** against ALL already-placed
  pills. A pill dropped off its rect sets `ClusterHull.leader`, and the canvas draws a thin dashed
  **leader line** from the pill UP to the rect's bottom-center (`anchorX/anchorY`). Concentric
  coincident rings are stepped by `NEST_STEP` (30) > pill height, so each ring's pill sits on its own
  bottom edge without stacking.

## Shared component

`TopologyView` is mounted in **two** places, both via `dynamic(..., { ssr: false })`:
- `apps/dashboard/src/routes/(dashboard)/clusters/index.tsx` — full page (topology + the raw
  `system.clusters` table; sibling route `replicas-status.tsx`).
- `apps/dashboard/src/routes/(dashboard)/overview.tsx` — the **Cluster Topology** tab
  (`OverviewTabConfig.customContent === 'topology'`), passing `detailHref="/clusters?host=N"`
  to show a "Cluster details" link through to the full page.

Keep it one component. The overview tab is config-driven; the `customContent` discriminator is the
only branch in `overview.tsx`.

## Test invariants — SPEC, not currently locked

> **Read this before trusting the numbers below.** The pure-logic test suite for
> this component (`__tests__/{model,geometry}.test.ts`) was **deleted with the
> Next.js app in #1613 and never replaced**. `topology-view.test.ts` went with it
> in #3217. The invariants listed here are still the contract the layout must
> honour, and every number in them is still live in `model-constants.ts` /
> `model-layout.ts` / `model-hulls.ts` — but **no test asserts any of them
> today.** Treat this section as the specification, and add a test when you
> change something it describes.

What still exists (and what it does and does not cover):

```shell
cd apps/dashboard && bun test src/components/cluster-topology/
# 9 tests across 2 files: 8 pure geometry (clampToHull / clientToSvg) + 1 memo-identity.
# topology-select.test.ts imports react, so it needs an installed tree; in a bare
# worktree it reports "Cannot find package 'react'" and the run exits non-zero.
```

Nothing asserts `OVERVIEW_TABS`. The old
`app/(dashboard)/overview/__tests__/overview.test.tsx` went with the Next.js app
(#1613), and the successor is **not** `lib/menu/__tests__/menu-config-snapshot.test.ts`
— `OVERVIEW_TABS` is defined in `src/routes/(dashboard)/-charts-config/index.ts`,
which no test references. **Update `-charts-config/index.ts` and the overview tab
rendering together; nothing will fail if you forget.**

The invariants a restored suite must lock (all currently unguarded):

- hull path shape per node count; **area-DESC z-order**; replication-edge rules.
- **shared-node-between-centroids** (overlap lens) — relative x order; `fitContent` translates
  all nodes equally so it's preserved.
- `CH_RENDER_CAP` (24) with every rendered node inside `[0,VB_W]×[0,model.vbHeight]`.
- **determinism**: identical input → identical paths + x/y + `vbHeight`.
- **data-driven height**: `vbHeight ≥ VB_H` floor; deeper nesting ⇒ taller; deterministic.
- **keeper separation**: every CH cluster box top sits below the lowest keeper (clamp works).
- **physical toggle**: `showPhysical:false` drops outline hulls + shrinks `vbHeight`; counts stay; node x unchanged.
- **local-duplicate merge** (the union-find above).
- `roundedRectPath` = closed, 4 corner arcs, clamped radius; keeper region = rounded rect for any N.

## Verification harness (how to eyeball changes safely) — CURRENTLY BROKEN

The canvas uses theme CSS vars, so you can't judge it from path strings. The intended check is
the committed harness **`scripts/topo-harness.tsx`**, which renders the **real `<TopoCanvas>`**
via `react-dom/server` (no glyph mirroring → no drift) for representative fixtures into a page
carrying the true light-theme OKLCH vars.

> **It does not run today.** `bun run scripts/topo-harness.tsx` exits 1 with
> `Cannot find module '../apps/dashboard/components/cluster-topology/__tests__/fixtures'`.
> Two problems, only one of which is a path:
>
> 1. **Repointable** — its `topo-canvas` / `model` imports point into
>    `apps/dashboard/components/cluster-topology/`, a directory that no longer exists; the
>    files live under `apps/dashboard/src/components/cluster-topology/` since #1613.
> 2. **Not repointable** — `__tests__/fixtures.ts` (`localDuplicateClusters`,
>    `overlapClusters`) was deleted with the Next.js app in #1613 and has **no successor
>    anywhere in the tree**. Without it the harness cannot run at all.
>
> So today there is **no working automated or harness check** for the invariants above. That is
> a real gap, not a documentation nit: see the "not currently locked" warning. Restoring the
> fixtures is a code change, deliberately not made here.

When it is restored, the method it uses is still the right one: screenshot it, and for hard
cases measure overflow directly in the browser — `getBoundingClientRect` of every `<text>` vs
the `<svg>`'s client box is the ground truth for "does a label clip the viewBox" (`getBBox`
returns *local* coords and will mislead). This catches the OKLCH black-fill regression,
label-outside-boundary, collisions, and clipping that pure tests can't.

## Safe-change recipes

- **Resize nodes**: change `CH_R`/`KP_R` in `model-constants.ts` only (`topo-glyphs.tsx` imports
  them via the `./model` barrel). Re-tune id `fontSize` + `fit()` limits so hostnames fit; bump
  envelopes/`enforceMinDistance` accordingly.
- **Move/restyle a label**: edit `NodeLabel` (or the LOCAL badge) in `topo-glyphs.tsx`, THEN
  update the matching `*Extent` in `model-constants.ts` so the boundary still encloses it. There
  is no test for this pairing — the harness is broken (above), so eyeball it.
- **Change overlap look**: it's normal alpha blending (no `mix-blend-mode`) + the `hashStr`
  jitter. Keep jitter **expand-only** so content never leaves the rect.
- **Add an overview sub-view**: extend `OverviewTabConfig.customContent` in
  `src/routes/(dashboard)/-charts-config/index.ts` + branch in `overview.tsx`. **No test
  asserts `OVERVIEW_TABS`**, so nothing will catch a forgotten render branch — check it by hand.
