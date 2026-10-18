import { z } from 'zod'

export const HostIdSchema = z
  .string()
  .transform((val) => parseInt(val, 10))
  .refine((val) => !Number.isNaN(val) && val >= 0, {
    message: 'hostId must be a non-negative integer',
  })

export const MenuCountKeySchema = z
  .string()
  .min(1, 'count key must not be empty')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'count key must contain only alphanumeric characters, hyphens, and underscores'
  )

export const BaseRequestSchema = z.object({
  hostId: HostIdSchema,
})

export const ChartRequestSchema = BaseRequestSchema.extend({
  interval: z.string().optional(),
  lastHours: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine((val) => !Number.isNaN(val) && val > 0, {
      message: 'lastHours must be a positive integer',
    })
    .optional(),
  params: z
    .string()
    .transform((val) => {
      try {
        return JSON.parse(val)
      } catch {
        throw new Error('params must be valid JSON')
      }
    })
    .optional(),
})

export const TableRequestSchema = BaseRequestSchema.extend({}).passthrough()

export const DataRequestSchema = BaseRequestSchema.extend({
  query: z.string().min(1, 'query must not be empty'),
  format: z.enum(['JSONEachRow', 'JSON', 'CSV', 'TSV']).optional(),
})

export const KillQueryActionSchema = z.object({
  action: z.literal('killQuery'),
  params: z.object({
    queryId: z.string().min(1, 'queryId must not be empty'),
  }),
})

export const OptimizeTableActionSchema = z.object({
  action: z.literal('optimizeTable'),
  params: z.object({
    table: z.string().min(1, 'table must not be empty'),
  }),
})

export const QuerySettingsActionSchema = z.object({
  action: z.literal('querySettings'),
  params: z.object({
    queryId: z.string().min(1, 'queryId must not be empty'),
  }),
})

export const ActionSchema = z.discriminatedUnion('action', [
  KillQueryActionSchema,
  OptimizeTableActionSchema,
  QuerySettingsActionSchema,
])

export type BaseRequest = z.infer<typeof BaseRequestSchema>
export type ChartRequest = z.infer<typeof ChartRequestSchema>
export type TableRequest = z.infer<typeof TableRequestSchema>
export type DataRequest = z.infer<typeof DataRequestSchema>
export type KillQueryAction = z.infer<typeof KillQueryActionSchema>
export type OptimizeTableAction = z.infer<typeof OptimizeTableActionSchema>
export type QuerySettingsAction = z.infer<typeof QuerySettingsActionSchema>
export type Action = z.infer<typeof ActionSchema>
