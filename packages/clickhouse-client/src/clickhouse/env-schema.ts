import { z } from 'zod'

export const clickhouseEnvSchema = z.object({
  CLICKHOUSE_HOST: z
    .string()
    .min(1, 'CLICKHOUSE_HOST is required')
    .describe('Comma-separated list of ClickHouse host URLs'),
  CLICKHOUSE_USER: z
    .string()
    .optional()
    .default('default')
    .describe('Comma-separated list of ClickHouse users'),
  CLICKHOUSE_PASSWORD: z
    .string()
    .optional()
    .default('')
    .describe('Comma-separated list of ClickHouse passwords'),
  CLICKHOUSE_NAME: z
    .string()
    .optional()
    .describe('Comma-separated list of custom host names'),
  CLICKHOUSE_MAX_EXECUTION_TIME: z.coerce
    .number()
    .positive()
    .optional()
    .default(60)
    .describe('Query timeout in seconds'),
})

export type ClickHouseEnv = z.infer<typeof clickhouseEnvSchema>

const ENV_FALLBACK: ClickHouseEnv = {
  CLICKHOUSE_HOST: '',
  CLICKHOUSE_USER: 'default',
  CLICKHOUSE_PASSWORD: '',
  CLICKHOUSE_NAME: undefined,
  CLICKHOUSE_MAX_EXECUTION_TIME: 60,
}

let _cachedEnv: ClickHouseEnv | null = null

/**
 * Validate ClickHouse environment variables.
 * Result is cached after first call since env vars don't change at runtime.
 * Returns parsed and validated config, or logs errors and returns defaults for graceful degradation.
 */
export function validateClickHouseEnv(): ClickHouseEnv {
  if (_cachedEnv) return _cachedEnv

  const result = clickhouseEnvSchema.safeParse({
    CLICKHOUSE_HOST: process.env.CLICKHOUSE_HOST,
    CLICKHOUSE_USER: process.env.CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD,
    CLICKHOUSE_NAME: process.env.CLICKHOUSE_NAME,
    CLICKHOUSE_MAX_EXECUTION_TIME: process.env.CLICKHOUSE_MAX_EXECUTION_TIME,
  })

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')

    console.error(
      `[ClickHouse] Environment validation failed:\n${formatted}\n\n` +
        'Please check your .env.local or deployment environment settings.\n' +
        'Required: CLICKHOUSE_HOST (e.g., http://localhost:8123)'
    )

    return ENV_FALLBACK
  }

  _cachedEnv = result.data
  return _cachedEnv
}

export function _resetEnvCache(): void {
  _cachedEnv = null
}
