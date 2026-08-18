export { assembleCatalog, tableKey } from './catalog'
export { compareCatalogs } from './compare'
export { namedDelta } from './named-delta'
export { emptySchemaDiffPayload } from './payload'
export { buildChangePlan } from './plan'
export { validateSchemaDiffSearch } from './search'
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
  SchemaIndex,
  SchemaProjection,
  TableDiff,
  TableDiffKind,
  TableRow,
  TableSchema,
} from './types'
