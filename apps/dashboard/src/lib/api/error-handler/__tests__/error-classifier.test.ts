import { classifyError } from '../error-classifier'
import { getStatusCodeForErrorType } from '../error-response-builder'
import { describe, expect, it } from 'bun:test'
import { ApiErrorType } from '@/lib/api/types'

const status = (err: unknown) =>
  getStatusCodeForErrorType(classifyError(err).type)

describe('classifyError: ClickHouse codes win over keywords', () => {
  it('Code 60 / UNKNOWN_TABLE -> TableNotFound (404)', () => {
    const err = new Error(
      "Code: 60. DB::Exception: Table system.backup_log doesn't exist. (UNKNOWN_TABLE)"
    )
    expect(classifyError(err).type).toBe(ApiErrorType.TableNotFound)
    expect(status(err)).toBe(404)
  })

  it('Code 47 / UNKNOWN_IDENTIFIER stays a QueryError even when it mentions a table', () => {
    // Regression: the bare "table" keyword used to turn this into a 404.
    const err = new Error(
      "Code: 47. DB::Exception: Missing columns: 'foo' while processing query: 'SELECT foo FROM system.tables'. (UNKNOWN_IDENTIFIER)"
    )
    expect(classifyError(err).type).toBe(ApiErrorType.QueryError)
    expect(status(err)).toBe(500)
  })

  it('Code 62 / SYNTAX_ERROR in FROM system.tables -> ValidationError (400), not 404', () => {
    const err = new Error(
      'Code: 62. DB::Exception: Syntax error: failed at position 20 (FROM system.tables WHER). (SYNTAX_ERROR)'
    )
    expect(classifyError(err).type).toBe(ApiErrorType.ValidationError)
    expect(status(err)).toBe(400)
  })

  it('Code 497 / ACCESS_DENIED -> PermissionError (403)', () => {
    const err = new Error(
      'Code: 497. DB::Exception: default: Not enough privileges on table system.query_log. (ACCESS_DENIED)'
    )
    expect(classifyError(err).type).toBe(ApiErrorType.PermissionError)
    expect(status(err)).toBe(403)
  })

  it('Code 516 / AUTHENTICATION_FAILED -> PermissionError (403)', () => {
    const err = new Error(
      'Code: 516. DB::Exception: default: Authentication failed. (AUTHENTICATION_FAILED)'
    )
    expect(classifyError(err).type).toBe(ApiErrorType.PermissionError)
  })

  it('Code 159 / TIMEOUT_EXCEEDED -> TimeoutError (504)', () => {
    const err = new Error(
      'Code: 159. DB::Exception: Timeout exceeded: elapsed 30 seconds reading table. (TIMEOUT_EXCEEDED)'
    )
    expect(classifyError(err).type).toBe(ApiErrorType.TimeoutError)
    expect(status(err)).toBe(504)
  })

  it('reads code / type fields from client error objects', () => {
    const err = Object.assign(new Error('something about a table'), {
      code: '60',
      type: 'UNKNOWN_TABLE',
    })
    expect(classifyError(err).type).toBe(ApiErrorType.TableNotFound)
    const syntax = Object.assign(new Error('bad table query'), { code: 62 })
    expect(classifyError(syntax).type).toBe(ApiErrorType.ValidationError)
  })
})

describe('classifyError: keyword fallbacks', () => {
  it('"Missing required parameter" -> ValidationError (400), not 404', () => {
    const err = new Error('Missing required parameter: hostId')
    expect(classifyError(err).type).toBe(ApiErrorType.ValidationError)
    expect(status(err)).toBe(400)
  })

  it('a message merely mentioning "table" is not TableNotFound', () => {
    expect(classifyError(new Error('failed to render table')).type).toBe(
      ApiErrorType.QueryError
    )
  })

  it('uncoded "Table x does not exist" still -> TableNotFound', () => {
    expect(
      classifyError(new Error('Table default.events does not exist')).type
    ).toBe(ApiErrorType.TableNotFound)
  })

  it('keeps network / unknown defaults', () => {
    expect(classifyError(new Error('connect ECONNREFUSED')).type).toBe(
      ApiErrorType.NetworkError
    )
    expect(classifyError('weird').type).toBe(ApiErrorType.QueryError)
  })
})
