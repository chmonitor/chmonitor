import {
  classify,
  hostStatusDown,
  type Probe,
  summarize,
} from './smoke-prod-classify'
import { describe, expect, test } from 'bun:test'

const probe = (over: Partial<Probe>): Probe => ({
  kind: 'chart',
  name: 'x',
  method: 'GET',
  path: '/x',
  status: 200,
  ms: 10,
  body: '{"success":true,"data":[]}',
  ...over,
})

const chErr = JSON.stringify({
  success: false,
  error: { type: 'query_error', message: 'Operation failed' },
})

describe('classify', () => {
  test('chart 500 with a healthy upstream is our regression', () => {
    expect(classify(probe({ status: 500, body: chErr }), false).verdict).toBe(
      'fail'
    )
  })

  test('chart 500 while host-status is down is attributed to the upstream', () => {
    expect(classify(probe({ status: 500, body: chErr }), true).verdict).toBe(
      'upstream'
    )
  })

  test('200 with success:false is not a pass', () => {
    expect(classify(probe({ body: chErr }), false).verdict).toBe('fail')
  })

  test('a 400 means the config needs params, not a regression', () => {
    expect(
      classify(probe({ kind: 'table', status: 400, body: chErr }), false)
        .verdict
    ).toBe('skip')
  })

  test('404 for a discovered chart fails even when the upstream is down', () => {
    expect(classify(probe({ status: 404, body: chErr }), true).verdict).toBe(
      'fail'
    )
  })

  test('page must carry the app shell', () => {
    expect(
      classify(probe({ kind: 'page', body: '<html>error</html>' }), false)
        .verdict
    ).toBe('fail')
    expect(
      classify(
        probe({
          kind: 'page',
          body: '<html><script src="/assets/index-Ab1.js">',
        }),
        false
      ).verdict
    ).toBe('pass')
  })

  test('anonymous write must be refused', () => {
    expect(classify(probe({ kind: 'auth', status: 401 }), false).verdict).toBe(
      'pass'
    )
    expect(classify(probe({ kind: 'auth', status: 200 }), false).verdict).toBe(
      'fail'
    )
    expect(classify(probe({ kind: 'auth', status: 501 }), false).verdict).toBe(
      'fail'
    )
  })

  test('anonymous health must not leak deployment metadata', () => {
    expect(
      classify(
        probe({ kind: 'health', body: '{"status":"ok","deployment":{}}' }),
        false
      ).verdict
    ).toBe('fail')
  })
})

describe('summarize', () => {
  test('an upstream outage across many charts is ONE finding', () => {
    const results = Array.from({ length: 50 }, (_, i) =>
      classify(probe({ name: `c${i}`, status: 500, body: chErr }), true)
    )
    const findings = summarize(results)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      key: 'upstream',
      severity: 'warn',
      count: 50,
    })
  })

  const failing = (rs: ReturnType<typeof classify>[]) =>
    summarize(rs).filter((f) => f.severity === 'fail')
  const outage = () =>
    Array.from({ length: 5 }, (_, i) =>
      classify(probe({ name: `c${i}`, status: 500, body: chErr }), true)
    )

  test('an outage alone does not fail the run', () => {
    expect(failing(outage())).toHaveLength(0)
    expect(summarize(outage())).toHaveLength(1)
  })

  test('an outage does not hide a broken page', () => {
    const page = classify(
      probe({ kind: 'page', name: '/overview', body: '<html>error</html>' }),
      true
    )
    const f = failing([...outage(), page])
    expect(f).toHaveLength(1)
    expect(f[0].key).toBe('page:/overview')
  })

  test('an outage does not hide a failed anonymous-write gate', () => {
    const auth = classify(
      probe({
        kind: 'auth',
        name: 'POST /x',
        status: 200,
        expect: 'unauthorized',
      }),
      true
    )
    expect(failing([...outage(), auth])).toHaveLength(1)
  })

  test('a healthy upstream with a broken chart fails', () => {
    const chart = classify(
      probe({ name: 'broken', status: 500, body: chErr }),
      false
    )
    expect(failing([chart])).toHaveLength(1)
  })

  test('slow passing probe is a warning, not a failure', () => {
    const [f] = summarize([
      classify(
        probe({ kind: 'page', ms: 9000, body: '<html>/assets/a.js' }),
        false
      ),
    ])
    expect(f.severity).toBe('warn')
  })
})

describe('hostStatusDown', () => {
  test('structured 5xx or no response is down; 200 is up', () => {
    expect(
      hostStatusDown(probe({ status: 500, body: '{"success":false}' }))
    ).toBe(true)
    expect(hostStatusDown(probe({ status: 0, body: '' }))).toBe(true)
    expect(hostStatusDown(probe({ status: 200 }))).toBe(false)
    // A bare 502 from the edge is not proof the upstream is down.
    expect(hostStatusDown(probe({ status: 502, body: '<html>' }))).toBe(false)
  })
})
