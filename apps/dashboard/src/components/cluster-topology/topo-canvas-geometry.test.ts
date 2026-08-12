/**
 * Tests for topo-canvas-geometry.ts — pure geometry helpers extracted from
 * TopoCanvas (see docs/knowledge/cluster-topology.md). No React, no DOM
 * dependency beyond a minimal SVGSVGElement stub for clientToSvg.
 */

import type { ClusterHull } from './model-types'

import { describe, expect, test } from 'bun:test'
import { clampToHull, clientToSvg } from './topo-canvas-geometry'

function makeHull(overrides: Partial<ClusterHull> = {}): ClusterHull {
  return {
    id: 'cluster-a',
    name: 'Cluster A',
    color: '#3b82f6',
    outline: false,
    d: 'M0 0',
    area: 1000,
    minX: 0,
    minY: 0,
    maxX: 200,
    maxY: 200,
    memberSig: 'a,b',
    nestRank: 0,
    labelX: 100,
    labelY: 190,
    anchorX: 100,
    anchorY: 0,
    leader: false,
    ...overrides,
  }
}

describe('clampToHull', () => {
  test('leaves a point untouched when it is already inside the padded box', () => {
    const hull = makeHull()
    const p = clampToHull(100, 100, hull)
    expect(p).toEqual({ x: 100, y: 100 })
  })

  test('clamps a point past the right/bottom edge back inside the padding', () => {
    const hull = makeHull()
    const p = clampToHull(9999, 9999, hull)
    // Padded to less than the raw maxX/maxY (CH clamp insets by CH_HALF /
    // CH_UP / CH_R+36 respectively), so the result must stay strictly inside.
    expect(p.x).toBeLessThan(hull.maxX)
    expect(p.y).toBeLessThan(hull.maxY)
  })

  test('clamps a point past the left/top edge back inside the padding', () => {
    const hull = makeHull()
    const p = clampToHull(-9999, -9999, hull)
    expect(p.x).toBeGreaterThan(hull.minX)
    expect(p.y).toBeGreaterThan(hull.minY)
  })

  test('falls back to the box center for a degenerate (too-small) hull', () => {
    const hull = makeHull({ minX: 0, maxX: 5, minY: 0, maxY: 5 })
    const p = clampToHull(2, 2, hull)
    expect(p).toEqual({ x: 2.5, y: 2.5 })
  })

  test('passes the point through unchanged when there is no hull', () => {
    const p = clampToHull(42, 7, null)
    expect(p).toEqual({ x: 42, y: 7 })
  })
})

describe('clientToSvg', () => {
  /**
   * Stubs the forward screen CTM (SVG → client space: client = svg*scale +
   * translate) and derives its true inverse, so `clientToSvg` — which calls
   * `ctm.inverse()` then `matrixTransform` — exercises the same math a real
   * `SVGSVGElement` would.
   */
  function makeSvgStub(
    scale: number,
    translateX: number,
    translateY: number
  ): SVGSVGElement {
    const inverse = {
      a: 1 / scale,
      d: 1 / scale,
      e: -translateX / scale,
      f: -translateY / scale,
    }
    const ctm = {
      a: scale,
      d: scale,
      e: translateX,
      f: translateY,
      inverse: () => inverse,
    }
    return {
      createSVGPoint: () => {
        const pt = {
          x: 0,
          y: 0,
          matrixTransform: (m: typeof inverse) => ({
            x: pt.x * m.a + m.e,
            y: pt.y * m.d + m.f,
          }),
        }
        return pt
      },
      getScreenCTM: () => ctm,
    } as any
  }

  test('maps a client point through the inverse screen CTM', () => {
    // SVG panned by (10, 20) relative to the viewport (no zoom): the inverse
    // subtracts the pan offset.
    const svg = makeSvgStub(1, 10, 20)
    const p = clientToSvg(svg, 30, 40)
    expect(p).toEqual({ x: 20, y: 20 })
  })

  test('accounts for zoom when mapping back to SVG space', () => {
    // SVG rendered at 2x scale with no pan: the inverse halves the coordinates.
    const svg = makeSvgStub(2, 0, 0)
    const p = clientToSvg(svg, 30, 40)
    expect(p).toEqual({ x: 15, y: 20 })
  })

  test('falls back to the raw client point when getScreenCTM is unavailable', () => {
    const svg = {
      createSVGPoint: () => ({ x: 0, y: 0 }),
      getScreenCTM: () => null,
    } as any as SVGSVGElement
    const p = clientToSvg(svg, 5, 6)
    expect(p).toEqual({ x: 5, y: 6 })
  })
})
