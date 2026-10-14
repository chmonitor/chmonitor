/**
 * CSV export utility for agent query results
 */

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''

  const headers = Object.keys(rows[0])

  const escape = (value: unknown): string => {
    const str = value === null || value === undefined ? '' : String(value)
    // Wrap in quotes if the value contains commas, quotes, or newlines/carriage returns
    if (
      str.includes(',') ||
      str.includes('"') ||
      str.includes('\n') ||
      str.includes('\r')
    ) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const headerRow = headers.map(escape).join(',')
  const dataRows = rows.map((row) =>
    headers.map((h) => escape(row[h])).join(',')
  )

  return [headerRow, ...dataRows].join('\n')
}

export function exportToCsv(
  rows: Record<string, unknown>[],
  filename?: string
): void {
  if (rows.length === 0) return

  const csv = rowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename ?? `export-${Date.now()}.csv`
  link.style.display = 'none'

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  // Release the object URL after a short delay to ensure download started
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
