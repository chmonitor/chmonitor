/**
 * Cluster topology data model — types + public surface. The implementation is
 * split across siblings (see docs/knowledge/cluster-topology.md):
 *
 *  - `model-types.ts` — the shared type/interface surface.
 *  - `model-constants.ts` — layout constants / geometry envelopes / palettes.
 *  - `model-parse.ts` — row coercion + node-identity heuristics.
 *  - `model-assemble.ts` — `assembleTopology`: raw rows → layout-free `TopologyData`.
 *  - `model-layout.ts` — `layoutTopology` / `buildTopologyModel` + node placement.
 *  - `model-hulls.ts` — cluster territory + keeper-region overlay geometry.
 *
 * Siblings must NOT import this barrel back (import cycle); they import
 * `./model-types` for shapes and each other directly.
 */

export * from './model-assemble'
export * from './model-constants'
export * from './model-hulls'
export * from './model-layout'
export * from './model-parse'
export * from './model-types'
