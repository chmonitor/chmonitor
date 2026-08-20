export type DdlDiffOp = 'equal' | 'insert' | 'delete' | 'replace'

export type DdlDiffSide = {
  no: number
  text: string
}

export type DdlDiffRow = {
  op: DdlDiffOp
  left: DdlDiffSide | null
  right: DdlDiffSide | null
}

/**
 * Myers-style LCS alignment of pretty-printed DDL lines for a side-by-side
 * view. Adjacent delete+insert pairs collapse to `replace`.
 */
export function alignDdlLines(source: string, target: string): DdlDiffRow[] {
  const left = source.length > 0 ? source.split('\n') : []
  const right = target.length > 0 ? target.split('\n') : []
  if (left.length === 0 && right.length === 0) return []
  if (left.length === 0) {
    return right.map((text, i) => ({
      op: 'insert',
      left: null,
      right: { no: i + 1, text },
    }))
  }
  if (right.length === 0) {
    return left.map((text, i) => ({
      op: 'delete',
      left: { no: i + 1, text },
      right: null,
    }))
  }

  const n = left.length
  const m = right.length
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array<number>(m + 1).fill(0)
  )
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] =
        left[i] === right[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const raw: DdlDiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      raw.push({
        op: 'equal',
        left: { no: i + 1, text: left[i] },
        right: { no: j + 1, text: right[j] },
      })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({
        op: 'delete',
        left: { no: i + 1, text: left[i] },
        right: null,
      })
      i += 1
    } else {
      raw.push({
        op: 'insert',
        left: null,
        right: { no: j + 1, text: right[j] },
      })
      j += 1
    }
  }
  while (i < n) {
    raw.push({
      op: 'delete',
      left: { no: i + 1, text: left[i] },
      right: null,
    })
    i += 1
  }
  while (j < m) {
    raw.push({
      op: 'insert',
      left: null,
      right: { no: j + 1, text: right[j] },
    })
    j += 1
  }

  return coalesceReplace(raw)
}

function coalesceReplace(rows: DdlDiffRow[]): DdlDiffRow[] {
  const out: DdlDiffRow[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const cur = rows[i]
    const next = rows[i + 1]
    if (cur.op === 'delete' && next?.op === 'insert') {
      out.push({
        op: 'replace',
        left: cur.left,
        right: next.right,
      })
      i += 1
      continue
    }
    if (cur.op === 'insert' && next?.op === 'delete') {
      out.push({
        op: 'replace',
        left: next.left,
        right: cur.right,
      })
      i += 1
      continue
    }
    out.push(cur)
  }
  return out
}
