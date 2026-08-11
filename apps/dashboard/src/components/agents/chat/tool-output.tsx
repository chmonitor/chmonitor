/**
 * Barrel re-export — the public boundary for `tool-output` used by
 * `assistant-ui/tool-fallback.tsx`. Implementation split across
 * `tool-output/` (see that folder for the decomposition):
 * - `output-shape.ts` — pure data-shaping helpers
 * - `result-table.tsx` — `ResultTable`, `ExpandTableButton`, `downloadCsv`
 * - `renderers.tsx` — `renderToolOutput` and its dispatchers
 * - `tool-call-part.tsx` — `ToolCallPart`, the exported public API
 */
export type { AgentToolPart } from './tool-output/tool-call-part'

export { renderToolOutput } from './tool-output/renderers'
export { ToolCallPart } from './tool-output/tool-call-part'
