export function sanitizeQueryParams(
  params: Record<string, unknown>
): Record<string, string> {
  const sanitized: Record<string, string> = {}

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue
    }

    if (value === null) {
      sanitized[key] = ''
      continue
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      sanitized[key] = String(value)
      continue
    }

    if (Array.isArray(value)) {
      sanitized[key] = value.map((v) => String(v)).join(',')
      continue
    }

    if (typeof value === 'object') {
      sanitized[key] = JSON.stringify(value)
      continue
    }

    sanitized[key] = String(value)
  }

  return sanitized
}

export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str
  }
  return `${str.substring(0, maxLength)}...`
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value)
}

export function isPositiveNumber(value: unknown): value is number {
  return isValidNumber(value) && value >= 0
}
