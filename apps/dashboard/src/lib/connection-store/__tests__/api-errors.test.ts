import { mapConnectionApiError } from '../api-errors'
import { ConnectionStoreError } from '../types'
import { describe, expect, it } from 'bun:test'
import { ConversationStoreError } from '@/lib/conversation-store/types'

const CONTEXT = { route: '/api/v1/user-connections', method: 'GET' }

describe('mapConnectionApiError', () => {
  it('maps ConnectionStoreError UNAUTHORIZED to 401', async () => {
    const response = mapConnectionApiError(
      new ConnectionStoreError('sign in required', 'UNAUTHORIZED'),
      CONTEXT
    )
    expect(response.status).toBe(401)
  })

  it('maps ConnectionStoreError NOT_FOUND to 404', async () => {
    const response = mapConnectionApiError(
      new ConnectionStoreError('missing', 'NOT_FOUND'),
      CONTEXT
    )
    expect(response.status).toBe(404)
  })

  it('maps ConversationStoreError UNAUTHORIZED to 401', async () => {
    const response = mapConnectionApiError(
      new ConversationStoreError('auth required', 'UNAUTHORIZED'),
      CONTEXT
    )
    expect(response.status).toBe(401)
  })

  it('maps ConnectionStoreError LIMIT_EXCEEDED to 402', async () => {
    const response = mapConnectionApiError(
      new ConnectionStoreError('Host limit reached', 'LIMIT_EXCEEDED'),
      CONTEXT
    )
    expect(response.status).toBe(402)
  })
})
