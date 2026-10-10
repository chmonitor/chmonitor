import { LocalFavoritesBackend } from './use-query-favorites'
import { beforeEach, describe, expect, test } from 'bun:test'

// Mock localStorage — shared mutable store reset in beforeEach.
let storage: Record<string, string> = {}
const mockLocalStorage = {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => {
    storage[k] = v
  },
  removeItem: (k: string) => {
    delete storage[k]
  },
}

describe('LocalFavoritesBackend', () => {
  let backend: LocalFavoritesBackend

  beforeEach(() => {
    storage = {}
    backend = new LocalFavoritesBackend(mockLocalStorage)
  })

  test('save throws when storage rejects the write (quota)', () => {
    const full = new LocalFavoritesBackend({
      ...mockLocalStorage,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(() =>
      full.save({
        title: 't',
        sql: 'SELECT 1',
        tags: [],
        hostId: 0,
        database: null,
        shareUrl: '',
      })
    ).toThrow(/Could not save favorite/)
  })

  test('list returns empty initially', () => {
    expect(backend.list()).toEqual([])
  })

  test('save persists a favorite', () => {
    backend.save({
      title: 'Top tables',
      sql: 'SELECT * FROM system.tables LIMIT 10',
      tags: ['perf'],
      hostId: 0,
      database: null,
      shareUrl: 'http://localhost/sql?q=SELECT&host=0',
    })

    const list = backend.list()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('Top tables')
    expect(list[0].sql).toBe('SELECT * FROM system.tables LIMIT 10')
    expect(list[0].tags).toEqual(['perf'])
    expect(list[0].hostId).toBe(0)
    expect(list[0].database).toBeNull()
    expect(typeof list[0].createdAt).toBe('number')
  })

  test('remove deletes by id', () => {
    backend.save({
      title: 'A',
      sql: 'SELECT 1',
      tags: [],
      hostId: 0,
      database: null,
      shareUrl: '',
    })
    backend.save({
      title: 'B',
      sql: 'SELECT 2',
      tags: [],
      hostId: 0,
      database: null,
      shareUrl: '',
    })

    const [second, first] = backend.list() // newest first
    expect(backend.list()).toHaveLength(2)

    backend.remove(first.id)
    const remaining = backend.list()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(second.id)
  })

  test('update patches title and tags', () => {
    backend.save({
      title: 'Original',
      sql: 'SELECT 1',
      tags: ['old'],
      hostId: 0,
      database: null,
      shareUrl: '',
    })

    const [fav] = backend.list()
    backend.update(fav.id, { title: 'Updated', tags: ['new', 'tag'] })

    const [updated] = backend.list()
    expect(updated.title).toBe('Updated')
    expect(updated.tags).toEqual(['new', 'tag'])
    // other fields preserved
    expect(updated.sql).toBe('SELECT 1')
    expect(updated.id).toBe(fav.id)
  })

  test('save generates a stable id', () => {
    backend.save({
      title: 'Q1',
      sql: 'SELECT now()',
      tags: [],
      hostId: 0,
      database: null,
      shareUrl: '',
    })

    const [fav] = backend.list()
    expect(typeof fav.id).toBe('string')
    expect(fav.id.length).toBeGreaterThan(0)
    // A second save of different SQL should get a different id.
    backend.save({
      title: 'Q2',
      sql: 'SELECT 1',
      tags: [],
      hostId: 0,
      database: null,
      shareUrl: '',
    })
    const [newest, oldest] = backend.list()
    expect(newest.id).not.toBe(oldest.id)
  })

  test('isFavorited matches on trimmed sql', () => {
    backend.save({
      title: 'Q',
      sql: 'SELECT 1',
      tags: [],
      hostId: 0,
      database: null,
      shareUrl: '',
    })

    expect(backend.isFavorited('SELECT 1')).toBe(true)
    // Leading/trailing whitespace should still match.
    expect(backend.isFavorited('  SELECT 1  ')).toBe(true)
    expect(backend.isFavorited('SELECT 2')).toBe(false)
  })

  test('list is ordered newest-first', () => {
    backend.save({
      title: 'First',
      sql: 'SELECT 1',
      tags: [],
      hostId: 0,
      database: null,
      shareUrl: '',
    })
    backend.save({
      title: 'Second',
      sql: 'SELECT 2',
      tags: [],
      hostId: 0,
      database: null,
      shareUrl: '',
    })

    const list = backend.list()
    expect(list[0].title).toBe('Second')
    expect(list[1].title).toBe('First')
  })
})
