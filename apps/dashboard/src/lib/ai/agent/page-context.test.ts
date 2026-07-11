/**
 * Unit tests for the client-side page-context helpers (`getPageLabel` /
 * `buildPageContext`) that resolve the "current page" hint the floating agent
 * widget attaches to each request and surfaces as the composer chip.
 *
 * Title resolution goes through the menu-driven breadcrumb lookup, with a
 * segment-title fallback for routes that aren't registered in the menu — so
 * these assertions stay stable even as the menu evolves.
 */

import { buildPageContext, getPageLabel } from './page-context'
import { describe, expect, test } from 'bun:test'

describe('getPageLabel', () => {
  test('resolves a registered route to its menu title', () => {
    expect(getPageLabel('/overview')).toBe('Overview')
    expect(getPageLabel('/merges')).toBe('Merges')
  })

  test('ignores the query string when resolving', () => {
    expect(getPageLabel('/merges?host=1')).toBe('Merges')
  })

  test('falls back to a title-cased segment for unregistered routes', () => {
    expect(getPageLabel('/some-unregistered-xyz')).toBe('Some Unregistered Xyz')
  })

  test('returns undefined for the root path (no segment to title)', () => {
    expect(getPageLabel('/')).toBeUndefined()
  })
})

describe('buildPageContext', () => {
  test('carries the raw route plus the resolved label', () => {
    expect(buildPageContext('/merges')).toEqual({
      route: '/merges',
      label: 'Merges',
    })
  })

  test('omits the label when none resolves', () => {
    expect(buildPageContext('/')).toEqual({ route: '/' })
  })
})
