export type { SchemaDiffSearch } from './search'
export type {
  ColumnRow,
  FieldChange,
  IndexRow,
  PlanItem,
  PlanItemKind,
  PlanRisk,
  ProjectionRow,
  SchemaCatalog,
  SchemaChangePlan,
  SchemaColumn,
  SchemaDiffHostInfo,
  SchemaDiffResponse,
  SchemaDiffResult,
  SchemaDiffScope,
  SchemaIndex,
  SchemaProjection,
  TableDiff,
  TableDiffKind,
  TableRow,
  TableSchema,
} from './types'

export { assembleCatalog, tableKey } from './catalog'
export { compareCatalogs } from './compare'
export { buildExampleSchemaDiff } from './example'
export { namedDelta } from './named-delta'
export { emptySchemaDiffPayload } from './payload'
export { buildChangePlan } from './plan'
export {
  buildSchemaDiffRequest,
  validateSchemaDiffSearch,
} from './search'
