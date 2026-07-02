/**
 * Shared CSV serialization utilities.
 *
 * Used by both the data-table CSV export button (column/row based, driven by
 * a TanStack table) and the chart card CSV export button (array-of-objects
 * based, driven by the SWR chart data array).
 */

/**
 * Convert a value to a CSV-safe string.
 * Handles null, undefined, objects, and strings with special characters.
 */
export function valueToCsv(value: unknown): string {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return ''
  }

  // Handle objects (convert to JSON string)
  if (typeof value === 'object') {
    value = JSON.stringify(value)
  }

  // Convert to string
  const strValue = String(value)

  // If the value contains quotes, commas, or line breaks (LF or CR), wrap in
  // quotes and escape quotes. A lone CR must also trigger quoting, otherwise
  // spreadsheet parsers treat it as a row separator.
  if (
    strValue.includes('"') ||
    strValue.includes(',') ||
    strValue.includes('\n') ||
    strValue.includes('\r')
  ) {
    return `"${strValue.replace(/"/g, '""')}"`
  }

  return strValue
}

/**
 * Serialize an array of plain objects to CSV.
 *
 * The header row is the union of keys across all rows (preserving first-seen
 * order). Returns null when the input has no rows.
 */
export function arrayToCsv(
  rows: ReadonlyArray<Record<string, unknown>>
): string | null {
  if (rows.length === 0) {
    return null
  }

  // Collect column keys in first-seen order across all rows so rows with
  // sparse/uneven shapes still serialize completely.
  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    }
  }

  if (keys.length === 0) {
    return null
  }

  const csvRows = [keys.map(valueToCsv).join(',')]
  for (const row of rows) {
    csvRows.push(keys.map((key) => valueToCsv(row[key])).join(','))
  }

  return csvRows.join('\n')
}

/**
 * Trigger a browser download for the given CSV content.
 */
export function downloadCsv(content: string, filename: string) {
  // Create a Blob with the CSV content
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })

  // Create a temporary URL and trigger download
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.csv`

  // Trigger download and cleanup
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Slugify a label into a safe filename fragment (lowercase, hyphenated).
 * Falls back to the provided default when nothing usable remains.
 */
export function slugifyFilename(
  label: string | undefined,
  fallback = 'chart-export'
): string {
  if (!label) return fallback
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}
