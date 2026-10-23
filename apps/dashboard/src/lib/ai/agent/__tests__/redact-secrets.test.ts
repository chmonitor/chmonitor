import { redactSecrets, sanitizeAgentError } from '../errors'
import { describe, expect, test } from 'bun:test'

const cases: ReadonlyArray<readonly [string, string, string]> = [
  [
    's3 positional key and secret',
    "SELECT * FROM s3('https://b.s3.amazonaws.com/x.csv', 'AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'CSV', 'a UInt8')",
    "SELECT * FROM s3('https://b.s3.amazonaws.com/x.csv', '[redacted]', '[redacted]', 'CSV', 'a UInt8')",
  ],
  [
    's3 session token',
    "s3('https://b/x', 'AKIAIOSFODNN7EXAMPLE', 'sekret/key+value', 'IQoJb3JpZ2luX2VjEXAMPLETOKENVALUE0123456789', 'Parquet')",
    "s3('https://b/x', '[redacted]', '[redacted]', '[redacted]', 'Parquet')",
  ],
  [
    's3Cluster shifts by the cluster arg',
    "s3Cluster('c1', 'https://b/x', 'AKIAIOSFODNN7EXAMPLE', 'sekret/key+value', 'CSV')",
    "s3Cluster('c1', 'https://b/x', '[redacted]', '[redacted]', 'CSV')",
  ],
  [
    'named credential settings',
    "s3('https://b/x', access_key_id = 'AKIAIOSFODNN7EXAMPLE', secret_access_key='abc123XYZ')",
    "s3('https://b/x', access_key_id = '[redacted]', secret_access_key='[redacted]')",
  ],
  [
    'mysql user and password',
    "SELECT * FROM mysql('db.internal:3306', 'shop', 'orders', 'root', 'hunter2hunter2')",
    "SELECT * FROM mysql('db.internal:3306', 'shop', 'orders', '[redacted]', '[redacted]')",
  ],
  [
    'postgresql password containing comma and paren, schema kept',
    "postgresql('pg:5432', 'app', 'users', 'svc', 'p@ss,word)', 'public')",
    "postgresql('pg:5432', 'app', 'users', '[redacted]', '[redacted]', 'public')",
  ],
  [
    'remote with separate db and table',
    "remote('ch1:9000', 'default', 'events', 'admin', 'topsecret')",
    "remote('ch1:9000', 'default', 'events', '[redacted]', '[redacted]')",
  ],
  [
    'remoteSecure with db.table form',
    "remoteSecure('ch1:9440', default.events, 'admin', 'topsecret')",
    "remoteSecure('ch1:9440', default.events, '[redacted]', '[redacted]')",
  ],
  [
    'unterminated call from a truncated error',
    "Code: 1. mysql('h:3306', 'd', 't', 'root', 'hunter2hun",
    "Code: 1. mysql('h:3306', 'd', 't', '[redacted]', '[redacted]'",
  ],
  [
    'url() userinfo',
    "SELECT * FROM url('https://alice:s3cr3t@files.example.com/a.csv', 'CSV')",
    "SELECT * FROM url('https://[redacted]@files.example.com/a.csv', 'CSV')",
  ],
  [
    'url() signed query string',
    "url('https://b.example.com/a.csv?X-Amz-Signature=deadbeef01&X-Amz-Expires=60', 'CSV')",
    "url('https://b.example.com/a.csv?X-Amz-Signature=[redacted]&X-Amz-Expires=60', 'CSV')",
  ],
  [
    'email address',
    'Authentication failed for first.last+ops@example.co.uk, retry',
    'Authentication failed for [redacted-email], retry',
  ],
  [
    'IPv4 with port',
    'Connection refused: 10.0.12.7:9000',
    'Connection refused: [redacted-ip]:9000',
  ],
  [
    'IPv6 compressed',
    'Cannot connect to [2001:db8::1]:9000 and fe80::1',
    'Cannot connect to [[redacted-ip]]:9000 and [redacted-ip]',
  ],
  [
    'IPv6 full',
    'peer 2001:0db8:85a3:0000:0000:8a2e:0370:7334 reset',
    'peer [redacted-ip] reset',
  ],
]

describe('redactSecrets: credentials, emails, IPs', () => {
  test.each(cases)('%s', (_name, input, expected) => {
    expect(redactSecrets(input)).toBe(expected)
  })

  test('no secret value survives in any table-driven input', () => {
    const leaks = [
      'AKIAIOSFODNN7EXAMPLE',
      'hunter2hunter2',
      'topsecret',
      's3cr3t',
      'deadbeef01',
      'ops@example',
    ]
    for (const [, input] of cases) {
      const out = redactSecrets(input)
      for (const leak of leaks) expect(out).not.toContain(leak)
    }
  })
})

describe('redactSecrets: false positives', () => {
  const untouched = [
    "s3 without credentials: \"s3('https://b/x.csv', 'CSVWithNames', 'id UInt64, name String')\"",
    "s3('https://b/x.csv', 'CSV', 'auto', 'gzip')",
    'ClickHouse server version 26.5.1.882 (official build)',
    '(version 24.8.1.100 (official build))',
    'Requires ClickHouse 24.3.2.23 or newer',
    'running v25.8.1.1',
    'upgrade to 23.8.1.2992',
    'bare version 24.8.1.100 in a table cell',
    'timestamp 12:34:56 elapsed 10:20:30',
    'Poco::Exception and std::string failure in DB::Foo',
    'Code: 60. DB::Exception: Table default.t does not exist',
    'name@ without a domain, and 1.2.3 is not an address',
  ]
  test.each(untouched)('%s', (input) => {
    expect(redactSecrets(input)).toBe(input)
  })
})

describe('redactSecrets: existing behavior', () => {
  test('extra secrets, userinfo, bearer and provider keys', () => {
    expect(redactSecrets('key=mykeyvalue1 here', ['mykeyvalue1'])).toBe(
      'key=[redacted] here'
    )
    expect(redactSecrets('https://u:p@host/x')).toBe(
      'https://[redacted]@host/x'
    )
    expect(redactSecrets('Bearer abcdefghijkl')).toBe('Bearer [redacted]')
    expect(redactSecrets('sk-abcdefghijklmnop')).toBe('[redacted]')
  })

  test('sanitizeAgentError redacts message, details and upstreamMessage', () => {
    const out = sanitizeAgentError({
      message: "mysql('h:1','d','t','u','pw123456')",
      details: 'host 10.1.2.3',
      upstreamMessage: 'mail me@example.com',
    } as Parameters<typeof sanitizeAgentError>[0])
    expect(out.message).not.toContain('pw123456')
    expect(out.details).toBe('host [redacted-ip]')
    expect(out.upstreamMessage).toBe('mail [redacted-email]')
  })
})
