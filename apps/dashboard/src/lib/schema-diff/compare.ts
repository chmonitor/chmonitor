import type {
  FieldChange,
  SchemaCatalog,
  SchemaDiffResult,
  TableDiff,
  TableSchema,
} from './types'

import { tableKey } from './catalog'
import { namedDelta } from './named-delta'

function byTableKey(catalog: SchemaCatalog): Map<string, TableSchema> {
  const map = new Map<string, TableSchema>()
  for (const table of catalog.tables) {
    map.set(tableKey(table.database, table.table), table)
  }
  return map
}

function collectChanges(
  source: TableSchema,
  target: TableSchema
): FieldChange[] {
  const changes: FieldChange[] = []

  const scalar: Array<
    keyof Pick<
      TableSchema,
      'engine' | 'sortingKey' | 'partitionKey' | 'primaryKey'
    >
  > = ['engine', 'sortingKey', 'partitionKey', 'primaryKey']

  for (const field of scalar) {
    if (source[field] !== target[field]) {
      changes.push({ field, source: source[field], target: target[field] })
    }
  }

  const columns = namedDelta(
    source.columns,
    target.columns,
    (a, b) => a.type === b.type && a.codec === b.codec
  )
  for (const col of columns.added) {
    changes.push({ field: `column:${col.name}`, source: col.type, target: '' })
  }
  for (const col of columns.removed) {
    changes.push({ field: `column:${col.name}`, source: '', target: col.type })
  }
  for (const { name, source: src, target: tgt } of columns.changed) {
    if (src.type !== tgt.type) {
      changes.push({
        field: `column_type:${name}`,
        source: src.type,
        target: tgt.type,
      })
    }
    if (src.codec !== tgt.codec) {
      changes.push({
        field: `column_codec:${name}`,
        source: src.codec,
        target: tgt.codec,
      })
    }
  }

  const indexes = namedDelta(
    source.indexes,
    target.indexes,
    (a, b) =>
      a.type === b.type && a.expr === b.expr && a.granularity === b.granularity
  )
  for (const idx of indexes.added) {
    changes.push({
      field: `index:${idx.name}`,
      source: `${idx.type} ${idx.expr}`,
      target: '',
    })
  }
  for (const idx of indexes.removed) {
    changes.push({
      field: `index:${idx.name}`,
      source: '',
      target: `${idx.type} ${idx.expr}`,
    })
  }
  for (const { name, source: src, target: tgt } of indexes.changed) {
    changes.push({
      field: `index:${name}`,
      source: `${src.type} ${src.expr} ${src.granularity}`,
      target: `${tgt.type} ${tgt.expr} ${tgt.granularity}`,
    })
  }

  const projections = namedDelta(
    source.projections,
    target.projections,
    (a, b) => a.type === b.type && a.query === b.query
  )
  for (const proj of projections.added) {
    changes.push({
      field: `projection:${proj.name}`,
      source: proj.type,
      target: '',
    })
  }
  for (const proj of projections.removed) {
    changes.push({
      field: `projection:${proj.name}`,
      source: '',
      target: proj.type,
    })
  }

  return changes
}

export function compareCatalogs(
  source: SchemaCatalog,
  target: SchemaCatalog
): SchemaDiffResult {
  const sourceMap = byTableKey(source)
  const targetMap = byTableKey(target)
  const keys = new Set([...sourceMap.keys(), ...targetMap.keys()])

  const onlySource: TableDiff[] = []
  const onlyTarget: TableDiff[] = []
  const changed: TableDiff[] = []
  const identical: TableDiff[] = []

  for (const key of [...keys].sort()) {
    const src = sourceMap.get(key)
    const tgt = targetMap.get(key)

    if (src && !tgt) {
      onlySource.push({ key, kind: 'only_source', source: src, changes: [] })
      continue
    }
    if (tgt && !src) {
      onlyTarget.push({ key, kind: 'only_target', target: tgt, changes: [] })
      continue
    }
    if (!src || !tgt) continue

    const changes = collectChanges(src, tgt)
    const row: TableDiff = {
      key,
      kind: changes.length > 0 ? 'changed' : 'identical',
      source: src,
      target: tgt,
      changes,
    }
    if (changes.length > 0) changed.push(row)
    else identical.push(row)
  }

  return { onlySource, onlyTarget, changed, identical }
}
