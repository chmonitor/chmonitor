export function exportCsv<T>(
  headers: readonly string[],
  rows: T[],
  toFields: (row: T) => unknown[],
  filenamePrefix: string
): void {
  if (typeof document === 'undefined') return
  const escape = (value: unknown) =>
    `"${String(value ?? '').replace(/"/g, '""')}"`
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(toFields(row).map(escape).join(','))
  }
  const blob = new Blob([lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
