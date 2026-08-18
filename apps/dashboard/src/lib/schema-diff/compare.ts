import { tableKey } from './catalog'
import type {
  FieldChange,
  SchemaCatalog,
  SchemaDiffResult,
  TableDiff,
  TableSchema,
} from './types'

function byTableKey(catalog: SchemaCatalog): Map<string, TableSchema> {
  const map = new Map<string, TableSchema>()
  for (const table of catalog.tables) {
    map.set(tableKey(table.database, table.table), table)
  }
  return map
}

function mapByName<T extends { name: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.name, item]))
}

function collectChanges(source: TableSchema, target: TableSchema): FieldChange[] {
  const changes: FieldChange[] = []

  const scalar: Array<keyof Pick<
    TableSchema,
    'engine' | 'sortingKey' | 'partitionKey' | 'primaryKey'
  >> = ['engine', 'sortingKey', 'partitionKey', 'primaryKey']

  for (const field of scalar) {
    if (source[field] !== target[field]) {
      changes.push({ field, source: source[field], target: target[field] })
    }
  }

  const sourceCols = mapByName(source.columns)
  const targetCols = mapByName(target.columns)

  for (const [name, col] of sourceCols) {
    const other = targetCols.get(name)
    if (!other) {
      changes.push({ field: `column:${name}`, source: col.type, target: '' })
      continue
    }
    if (col.type !== other.type) {
      changes.push({
        field: `column_type:${name}`,
        source: col.type,
        target: other.type,
      })
    }
    if (col.codec !== other.codec) {
      changes.push({
        field: `column_codec:${name}`,
        source: col.codec,
        target: other.codec,
      })
    }
  }

  for (const [name, col] of targetCols) {
    if (!sourceCols.has(name)) {
      changes.push({ field: `column:${name}`, source: '', target: col.type })
    }
  }

  const sourceIdx = mapByName(source.indexes)
  const targetIdx = mapByName(target.indexes)
  for (const [name, idx] of sourceIdx) {
    const other = targetIdx.get(name)
    if (!other) {
      changes.push({
        field: `index:${name}`,
        source: `${idx.type} ${idx.expr}`,
        target: '',
      })
      continue
    }
    if (
      idx.type !== other.type ||
      idx.expr !== other.expr ||
      idx.granularity !== other.granularity
    ) {
      changes.push({
        field: `index:${name}`,
        source: `${idx.type} ${idx.expr} ${idx.granularity}`,
        target: `${other.type} ${other.expr} ${other.granularity}`,
      })
    }
  }
  for (const [name, idx] of targetIdx) {
    if (!sourceIdx.has(name)) {
      changes.push({
        field: `index:${name}`,
        source: '',
        target: `${idx.type} ${idx.expr}`,
      })
    }
  }

  const sourceProj = mapByName(source.projections)
  const targetProj = mapByName(target.projections)
  for (const [name, proj] of sourceProj) {
    if (!targetProj.has(name)) {
      changes.push({
        field: `projection:${name}`,
        source: proj.type,
        target: '',
      })
    }
  }
  for (const [name, proj] of targetProj) {
    if (!sourceProj.has(name)) {
      changes.push({
        field: `projection:${name}`,
        source: '',
        target: proj.type,
      })
    }
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
