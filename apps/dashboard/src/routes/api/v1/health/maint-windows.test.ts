/**
 * DELETE /api/v1/health/maint-windows must report what actually happened. It
 * used to answer `{ success: true }` for an unknown id, with no backend, and
 * when the backend threw — so the UI dropped a window that was still
 * suppressing alerts.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async () => null,
}))
mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwnerId: async () => 'owner-1',
}))

class MaintenanceStoreUnavailableError extends Error {}
let deleteImpl: (ownerId: string, id: string) => Promise<number> = async () => 1
const deleteCalls: Array<[string, string]> = []
mock.module('@/lib/health/maintenance-windows', () => ({
  MaintenanceStoreUnavailableError,
  createWindow: async () => {
    throw new Error('not used')
  },
  listWindows: async () => [],
  deleteWindow: (ownerId: string, id: string) => {
    deleteCalls.push([ownerId, id])
    return deleteImpl(ownerId, id)
  },
}))

const { __handleDeleteForTests: handleDelete } = await import('./maint-windows')

const del = (query: string) =>
  handleDelete(
    new Request(`http://localhost/api/v1/health/maint-windows${query}`, {
      method: 'DELETE',
    })
  )

beforeEach(() => {
  deleteImpl = async () => 1
  deleteCalls.length = 0
})

describe('DELETE /api/v1/health/maint-windows', () => {
  test('200 with the deleted count when the window existed', async () => {
    const res = await del('?id=w1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, deleted: 1 })
    expect(deleteCalls).toEqual([['owner-1', 'w1']])
  })

  test('404 for an id this owner does not have', async () => {
    deleteImpl = async () => 0
    const res = await del('?id=ghost')
    expect(res.status).toBe(404)
    expect((await res.json()).success).toBe(false)
  })

  test('503 when no backend is configured', async () => {
    deleteImpl = async () => {
      throw new MaintenanceStoreUnavailableError('no backend')
    }
    const res = await del('?id=w1')
    expect(res.status).toBe(503)
  })

  test('500 when the backend fails', async () => {
    deleteImpl = async () => {
      throw new Error('D1 exploded')
    }
    const res = await del('?id=w1')
    expect(res.status).toBe(500)
    expect((await res.json()).error.message).toBe('D1 exploded')
  })

  test('400 without an id', async () => {
    const res = await del('')
    expect(res.status).toBe(400)
    expect(deleteCalls).toEqual([])
  })
})
