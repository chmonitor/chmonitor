import type { SchemaChangePlan, SchemaDiffResult } from './types'

export const EMPTY_SCHEMA_DIFF: SchemaDiffResult = {
  onlySource: [],
  onlyTarget: [],
  changed: [],
  identical: [],
}

export const EMPTY_SCHEMA_PLAN: SchemaChangePlan = {
  items: [],
  safeStatements: [],
}

export function emptySchemaDiffPayload<T extends Record<string, unknown>>(
  extra: T
): T & { diff: SchemaDiffResult; plan: SchemaChangePlan } {
  return {
    ...extra,
    diff: EMPTY_SCHEMA_DIFF,
    plan: EMPTY_SCHEMA_PLAN,
  }
}
