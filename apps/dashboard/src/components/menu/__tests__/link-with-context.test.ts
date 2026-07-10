import { describe, expect, test } from 'bun:test'
import { mergeHrefSearch } from '@/components/menu/link-with-context'

// Regression coverage for https://github.com/chmonitor/chmonitor/issues/2496:
// HostPrefixedLink used to drop a menu href's own query string entirely,
// silently killing deep-link intent like `/keeper?path=/` and
// `/charts?name=...`. mergeHrefSearch is the pure param-merging logic
// extracted so it's testable without rendering the component.
describe('mergeHrefSearch', () => {
  test('merges query params from the href with the host param', () => {
    expect(mergeHrefSearch('/charts?name=a,b', 2)).toEqual({
      name: 'a,b',
      host: 2,
    })
  })

  test('href without a query string yields only host', () => {
    expect(mergeHrefSearch('/merges', 0)).toEqual({ host: 0 })
  })

  test('host always wins over a colliding host param baked into the href', () => {
    expect(mergeHrefSearch('/x?host=9', 1)).toEqual({ host: 1 })
  })

  // The two real menu.ts entries called out in the bug report.
  test('keeper deep link preserves path=/', () => {
    expect(mergeHrefSearch('/keeper?path=/', 0)).toEqual({
      path: '/',
      host: 0,
    })
  })

  test('charts deep link preserves the comma-separated chart names', () => {
    expect(
      mergeHrefSearch(
        '/charts?name=connections-http,connections-interserver',
        0
      )
    ).toEqual({
      name: 'connections-http,connections-interserver',
      host: 0,
    })
  })
})
