/**
 * Matrix filters (#4123): "write only" must use the level AFTER the readonly
 * cap, otherwise a readonly user with an INSERT grant looks like a writer.
 */

import type { AccessInputs } from './access-matrix'
import type { MatrixFilters } from './access-matrix-view'

import {
  grants,
  profileElements,
  profiles,
  roleGrants,
} from './__fixtures__/access-matrix-rows'
import { buildRows, filterRows } from './access-matrix-view'
import { describe, expect, test } from 'bun:test'

const inputs: AccessInputs = { grants, roleGrants, profiles, profileElements }
const users = [
  { name: 'admin2', storage: 'local_directory' },
  { name: 'analyst', storage: 'local_directory' },
  { name: 'default', storage: 'users_xml' },
  { name: 'writer', storage: 'local_directory' },
]
const rows = buildRows('user', users, ['db', 'other'], inputs)
const none: MatrixFilters = {
  search: '',
  database: '',
  writeOnly: false,
  hideConfigUsers: false,
}
const names = (f: Partial<MatrixFilters>) =>
  filterRows(rows, { ...none, ...f }).map((r) => r.access.grantee.name)

describe('access matrix filters', () => {
  test('no filter keeps every user', () => {
    expect(names({})).toEqual(['admin2', 'analyst', 'default', 'writer'])
  })

  test('search matches user names', () => {
    expect(names({ search: 'ANA' })).toEqual(['analyst'])
  })

  test('database filter keeps users that can at least read it', () => {
    expect(names({ database: 'other' })).toEqual(['analyst'])
  })

  test('write only uses the readonly-capped level', () => {
    expect(names({ writeOnly: true })).toEqual(['admin2'])
  })

  test('hide config users drops users.xml users', () => {
    expect(names({ hideConfigUsers: true })).not.toContain('default')
  })
})
