/**
 * Map a tool's JSON Schema (2020-12) input schema to Playground form fields.
 *
 * Deliberately simple: scalar properties become real inputs, and anything the
 * mapping cannot represent faithfully (nested objects, arrays, unions,
 * composition keywords) falls back to a raw-JSON textarea for the WHOLE form,
 * so the user is never silently prevented from sending a valid argument.
 */

import type { JsonSchema } from './playground-client'

export type FieldKind = 'string' | 'number' | 'boolean' | 'enum'

export interface FormField {
  name: string
  kind: FieldKind
  required: boolean
  description?: string
  /** Stringified default, used as the input placeholder. */
  default?: string
  /** Allowed values, for `kind: 'enum'`. */
  options?: string[]
}

export interface SchemaForm {
  fields: FormField[]
  /**
   * True when at least one property could not be mapped to a simple field, so
   * the UI must offer the raw-JSON editor instead of a partial form.
   */
  requiresRawJson: boolean
}

function schemaType(schema: JsonSchema): string | undefined {
  const { type } = schema
  if (Array.isArray(type)) {
    // e.g. ["string", "null"] from an optional field — use the non-null member.
    return type.find((t) => t !== 'null')
  }
  return type
}

function fieldKind(schema: JsonSchema): FieldKind | null {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return 'enum'
  switch (schemaType(schema)) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return null
  }
}

/**
 * Build the form model for a tool input schema.
 *
 * A missing/empty schema is a valid "no arguments" tool, not an error.
 */
export function buildSchemaForm(schema: JsonSchema | undefined): SchemaForm {
  const properties = schema?.properties
  if (!properties || Object.keys(properties).length === 0) {
    return { fields: [], requiresRawJson: false }
  }

  const required = new Set(schema?.required ?? [])
  const fields: FormField[] = []
  let requiresRawJson = false

  for (const [name, propSchema] of Object.entries(properties)) {
    const kind = fieldKind(propSchema)
    if (!kind) {
      requiresRawJson = true
      continue
    }
    fields.push({
      name,
      kind,
      required: required.has(name),
      description:
        typeof propSchema.description === 'string'
          ? propSchema.description
          : undefined,
      default:
        propSchema.default === undefined
          ? undefined
          : String(propSchema.default),
      ...(kind === 'enum'
        ? { options: (propSchema.enum ?? []).map((v) => String(v)) }
        : {}),
    })
  }

  // Required fields first, then declaration order — the shortest path to a
  // valid call.
  fields.sort((a, b) => Number(b.required) - Number(a.required))

  return { fields, requiresRawJson }
}

/**
 * Coerce raw string form values into JSON-RPC arguments.
 *
 * Empty values are OMITTED rather than sent as `""`/`NaN`: the server applies
 * the schema default, which is what an empty input means to the user. A number
 * field that cannot parse is dropped for the same reason — the UI reports it as
 * a validation error before the call is ever made.
 */
export function coerceFormValues(
  fields: FormField[],
  values: Record<string, string>
): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const field of fields) {
    const raw = values[field.name]
    if (raw === undefined || raw === '') continue
    switch (field.kind) {
      case 'number': {
        const parsed = Number(raw)
        if (Number.isFinite(parsed)) args[field.name] = parsed
        break
      }
      case 'boolean':
        args[field.name] = raw === 'true'
        break
      default:
        args[field.name] = raw
    }
  }
  return args
}

/**
 * Validate a filled form before sending. Returns the names of required fields
 * left empty plus number fields that do not parse.
 */
export function validateFormValues(
  fields: FormField[],
  values: Record<string, string>
): string[] {
  const errors: string[] = []
  for (const field of fields) {
    const raw = values[field.name]
    const empty = raw === undefined || raw === ''
    if (field.required && empty && field.default === undefined) {
      errors.push(`${field.name} is required`)
      continue
    }
    if (!empty && field.kind === 'number' && !Number.isFinite(Number(raw))) {
      errors.push(`${field.name} must be a number`)
    }
  }
  return errors
}

/** Parse the raw-JSON textarea, returning either arguments or an error string. */
export function parseRawArguments(
  raw: string
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, args: {} }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { ok: false, error: 'Arguments must be a JSON object.' }
    }
    return { ok: true, args: parsed as Record<string, unknown> }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid JSON',
    }
  }
}
