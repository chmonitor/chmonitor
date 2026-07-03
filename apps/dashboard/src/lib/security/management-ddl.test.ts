import {
  generateAlterUserDdl,
  generateCreateUserDdl,
  generateDropUserDdl,
  generateGrantPrivilegeDdl,
  generateGrantRoleDdl,
  generateRevokePrivilegeDdl,
  generateRevokeRoleDdl,
  isManagementEnabled,
} from './management-ddl'
import { afterEach, describe, expect, it } from 'bun:test'

// ---------------------------------------------------------------------------
// generateCreateUserDdl
// ---------------------------------------------------------------------------

describe('generateCreateUserDdl', () => {
  it('generates CREATE USER with password', () => {
    const sql = generateCreateUserDdl({ username: 'alice', password: 'secret' })
    expect(sql).toStartWith('CREATE USER')
    expect(sql).toContain('`alice`')
    expect(sql).toContain("IDENTIFIED BY 'secret'")
  })

  it('generates CREATE USER without password (NOT IDENTIFIED)', () => {
    const sql = generateCreateUserDdl({ username: 'bob' })
    expect(sql).toStartWith('CREATE USER')
    expect(sql).toContain('`bob`')
    expect(sql).toContain('NOT IDENTIFIED')
    expect(sql).not.toContain('IDENTIFIED BY')
  })

  it('includes DEFAULT ROLE when provided', () => {
    const sql = generateCreateUserDdl({
      username: 'carol',
      defaultRole: 'analyst',
    })
    expect(sql).toContain('DEFAULT ROLE `analyst`')
  })

  it('includes HOST NONE when host is NONE', () => {
    const sql = generateCreateUserDdl({ username: 'dave', host: 'NONE' })
    expect(sql).toContain('HOST NONE')
  })

  it('includes HOST IP when a specific IP is given', () => {
    const sql = generateCreateUserDdl({
      username: 'eve',
      host: '192.168.1.0/24',
    })
    expect(sql).toContain("HOST IP '192.168.1.0/24'")
  })

  it('omits HOST clause when host is ANY', () => {
    const sql = generateCreateUserDdl({ username: 'frank', host: 'ANY' })
    expect(sql).not.toContain('HOST')
  })

  it('omits HOST clause when host is undefined', () => {
    const sql = generateCreateUserDdl({ username: 'grace' })
    expect(sql).not.toContain('HOST')
  })

  it('includes DEFAULT DATABASE when provided', () => {
    const sql = generateCreateUserDdl({
      username: 'henry',
      defaultDatabase: 'analytics',
    })
    expect(sql).toContain('DEFAULT DATABASE `analytics`')
  })
})

// ---------------------------------------------------------------------------
// generateAlterUserDdl
// ---------------------------------------------------------------------------

describe('generateAlterUserDdl', () => {
  it('generates ALTER USER with new password', () => {
    const sql = generateAlterUserDdl({
      username: 'alice',
      newPassword: 'newpass',
    })
    expect(sql).toStartWith('ALTER USER')
    expect(sql).toContain('`alice`')
    expect(sql).toContain("IDENTIFIED BY 'newpass'")
  })

  it('generates ALTER USER with default role', () => {
    const sql = generateAlterUserDdl({ username: 'bob', defaultRole: 'admin' })
    expect(sql).toStartWith('ALTER USER')
    expect(sql).toContain('`bob`')
    expect(sql).toContain('DEFAULT ROLE `admin`')
  })

  it('generates ALTER USER with default database', () => {
    const sql = generateAlterUserDdl({
      username: 'carol',
      defaultDatabase: 'mydb',
    })
    expect(sql).toContain('DEFAULT DATABASE `mydb`')
  })
})

// ---------------------------------------------------------------------------
// generateDropUserDdl
// ---------------------------------------------------------------------------

describe('generateDropUserDdl', () => {
  it('generates DROP USER', () => {
    const sql = generateDropUserDdl('alice')
    expect(sql).toStartWith('DROP USER')
    expect(sql).toContain('`alice`')
  })
})

// ---------------------------------------------------------------------------
// generateGrantRoleDdl / generateRevokeRoleDdl
// ---------------------------------------------------------------------------

describe('generateGrantRoleDdl', () => {
  it('generates GRANT role TO user', () => {
    const sql = generateGrantRoleDdl('analyst', 'alice')
    expect(sql).toStartWith('GRANT')
    expect(sql).toContain('`analyst`')
    expect(sql).toContain('`alice`')
    expect(sql).toContain(' TO ')
  })
})

describe('generateRevokeRoleDdl', () => {
  it('generates REVOKE role FROM user', () => {
    const sql = generateRevokeRoleDdl('analyst', 'alice')
    expect(sql).toStartWith('REVOKE')
    expect(sql).toContain('`analyst`')
    expect(sql).toContain('`alice`')
    expect(sql).toContain(' FROM ')
  })
})

// ---------------------------------------------------------------------------
// generateGrantPrivilegeDdl / generateRevokePrivilegeDdl
// ---------------------------------------------------------------------------

describe('generateGrantPrivilegeDdl', () => {
  it('generates GRANT SELECT ON *.* TO user', () => {
    const sql = generateGrantPrivilegeDdl(
      { privilege: 'SELECT', on: '*.*' },
      'alice'
    )
    expect(sql).toStartWith('GRANT')
    expect(sql).toContain('SELECT')
    expect(sql).toContain('*.*')
    expect(sql).toContain('`alice`')
    expect(sql).not.toContain('WITH GRANT OPTION')
  })

  it('appends WITH GRANT OPTION when requested', () => {
    const sql = generateGrantPrivilegeDdl(
      { privilege: 'SELECT', on: 'mydb.mytable', withGrantOption: true },
      'bob'
    )
    expect(sql).toContain('WITH GRANT OPTION')
  })

  it('quotes a validated db.table target', () => {
    const sql = generateGrantPrivilegeDdl(
      { privilege: 'SELECT', on: 'db.events' },
      'u'
    )
    expect(sql).toBe('GRANT SELECT ON `db`.`events` TO `u`')
  })

  it('accepts *.* without quoting the wildcard', () => {
    const sql = generateGrantPrivilegeDdl({ privilege: 'ALL', on: '*.*' }, 'u')
    expect(sql).toBe('GRANT ALL ON *.* TO `u`')
  })

  it('accepts a column-list privilege', () => {
    const sql = generateGrantPrivilegeDdl(
      { privilege: 'SELECT(col1, col2)', on: 'db.t' },
      'u'
    )
    expect(sql).toContain('SELECT(col1, col2)')
  })

  it('accepts a digit-containing source privilege like S3', () => {
    const sql = generateGrantPrivilegeDdl({ privilege: 'S3', on: '*.*' }, 'u')
    expect(sql).toBe('GRANT S3 ON *.* TO `u`')
  })
})

describe('generateRevokePrivilegeDdl', () => {
  it('generates REVOKE privilege FROM user', () => {
    const sql = generateRevokePrivilegeDdl(
      { privilege: 'INSERT', on: 'mydb.*' },
      'carol'
    )
    expect(sql).toStartWith('REVOKE')
    expect(sql).toContain('INSERT')
    // 'mydb' is a validated identifier, so it is rebuilt quoted; '*' stays bare
    expect(sql).toContain('`mydb`.*')
    expect(sql).toContain('`carol`')
  })
})

// ---------------------------------------------------------------------------
// isManagementEnabled
// ---------------------------------------------------------------------------

describe('isManagementEnabled', () => {
  const origEnv = process.env.CLICKHOUSE_MANAGEMENT_ENABLED

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.CLICKHOUSE_MANAGEMENT_ENABLED
    } else {
      process.env.CLICKHOUSE_MANAGEMENT_ENABLED = origEnv
    }
  })

  it('returns false when env is not set', () => {
    delete process.env.CLICKHOUSE_MANAGEMENT_ENABLED
    expect(isManagementEnabled()).toBe(false)
  })

  it('returns false when env is set to a non-true value', () => {
    delete process.env.CLICKHOUSE_MANAGEMENT_ENABLED
    expect(
      isManagementEnabled({ CLICKHOUSE_MANAGEMENT_ENABLED: 'false' })
    ).toBe(false)
    expect(isManagementEnabled({ CLICKHOUSE_MANAGEMENT_ENABLED: '1' })).toBe(
      false
    )
  })

  it('returns true when explicit env map has CLICKHOUSE_MANAGEMENT_ENABLED=true', () => {
    expect(isManagementEnabled({ CLICKHOUSE_MANAGEMENT_ENABLED: 'true' })).toBe(
      true
    )
  })

  it('returns true when process.env has CLICKHOUSE_MANAGEMENT_ENABLED=true', () => {
    delete process.env.CLICKHOUSE_MANAGEMENT_ENABLED
    process.env.CLICKHOUSE_MANAGEMENT_ENABLED = 'true'
    expect(isManagementEnabled()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SQL injection safety
// ---------------------------------------------------------------------------

describe('SQL injection safety', () => {
  it('escapes a backtick in a username', () => {
    const sql = generateCreateUserDdl({ username: 'bad`user' })
    // The backtick should be doubled inside the identifier
    expect(sql).toContain('`bad``user`')
  })

  it('escapes single quotes in passwords', () => {
    const sql = generateCreateUserDdl({
      username: 'victim',
      password: "pass'word",
    })
    expect(sql).toContain("IDENTIFIED BY 'pass\\'word'")
  })

  it('escapes single quotes in HOST IP', () => {
    const sql = generateCreateUserDdl({
      username: 'hacker',
      host: "1.2.3.4' IDENTIFIED BY 'evil",
    })
    // Must not produce a valid injection — single quote is escaped
    expect(sql).not.toContain("IDENTIFIED BY 'evil'")
    expect(sql).toContain("\\'")
  })

  it('neutralizes a trailing backslash in a password so it cannot break out of the literal', () => {
    const sql = generateCreateUserDdl({
      username: 'u',
      password: 'a\\',
      defaultRole: 'analyst',
    })
    // The backslash is doubled, not left dangling before the closing quote
    expect(sql).toContain("IDENTIFIED BY 'a\\\\'")
    // The literal closed correctly, so the next clause follows intact (not truncated)
    expect(sql).toEndWith('DEFAULT ROLE `analyst`')
  })

  it('rejects SQL injection via the grant target', () => {
    expect(() =>
      generateGrantPrivilegeDdl(
        { privilege: 'SELECT', on: 'a TO attacker; --' },
        'victim'
      )
    ).toThrow('Invalid grant target')
  })

  it('rejects SQL injection via the privilege token', () => {
    expect(() =>
      generateGrantPrivilegeDdl({ privilege: "SELECT'; DROP", on: 'db.t' }, 'u')
    ).toThrow('Invalid privilege')
  })
})
