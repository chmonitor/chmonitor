import { type DeclarativeChart, declarativeChartSchema } from './schema'

export type ValidateChartResult =
  | { ok: true; chart: DeclarativeChart }
  | { ok: false; errors: string[] }

/**
 * Validate an unknown input against the declarative chart schema. Errors are
 * human-readable strings that include the field path.
 */
export function validateDeclarativeChart(input: unknown): ValidateChartResult {
  const result = declarativeChartSchema.safeParse(input)

  if (result.success) {
    return { ok: true, chart: result.data }
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
    return `${path}: ${issue.message}`
  })

  return { ok: false, errors }
}
