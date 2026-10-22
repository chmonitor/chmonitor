/// <reference types="cypress" />

/**
 * Off-screen polling — chart cells scrolled out of view stop auto-refreshing.
 *
 * Regression guard for #4076 (`ChartViewportBoundary` + `pausableInterval` +
 * `useRefetchOnResume`). Unit tests cover the hook logic against a fake
 * IntersectionObserver; this proves it in a real browser, where the observer,
 * the 200px root margin and TanStack Query's timers all interact.
 *
 * Determinism: `cy.clock()` is installed before `cy.visit`, so TanStack
 * Query's `refetchInterval` timers and `Date.now()` run on the fake clock and
 * a refresh interval costs one `cy.tick()`, not a real wait. Chart responses
 * are stubbed with an empty payload so the result does not depend on
 * ClickHouse (or on the API-key gate answering 401): only request counts are
 * asserted, never data.
 *
 * Counting rule. Every step advances the clock past the slowest chart
 * interval (5 min), then waits until the per-chart request counts stop
 * changing. An in-view chart fires once per step (a single `tick` may fire a
 * short interval many times, but the in-flight fetch dedupes them), so it must
 * gain at least STEPS - 1 requests (one step of slack for a refetch that lands
 * just outside the window). A paused chart must gain exactly 0 over the
 * measured steps.
 *
 * Why the phases are staged (flake fixed after #4115's CI run). Three things
 * are asynchronous in real time and invisible to `cy.tick`:
 *   1. `cy.intercept` handlers run in Cypress's proxy, so a request the browser
 *      issued at the end of one phase can be counted after the next phase has
 *      already taken its baseline. `settleCounts` therefore waits until the
 *      counts are unchanged across several real-time checks, before every
 *      baseline and after every step, instead of sleeping a fixed 150ms.
 *   2. A scroll reaches the app as IntersectionObserver entry -> setState ->
 *      render. TanStack Query only drops its `refetchInterval` timer on that
 *      render, so a tick that lands before it fires the old timer once. Each
 *      phase therefore runs one unasserted warm-up step first (`settleInto`):
 *      it absorbs that one transition fetch. A chart whose pause is really
 *      broken keeps firing during the measured steps and still fails.
 *   3. With the clock frozen, React's Suspense reveal throttle (a timer) can
 *      hold the lazy chart cells back, so the mount waits ticking in small
 *      steps rather than assuming the first fetches arrive.
 *
 * Layout. /history-queries stacks 7 charts in 4 rows above its table. At a
 * 1280x500 viewport row 1 is on screen and row 4 sits far below the 200px
 * margin (the spec asserts that geometry instead of assuming it).
 */

const PAGE = '/history-queries?host=0'
const TOP_CHARTS = ['query-count', 'query-duration'] as const
const BOTTOM_CHART = 'cancelled-queries'
const ALL_CHARTS = [
  ...TOP_CHARTS,
  'query-duration-percentiles',
  'query-memory',
  'query-count-by-user',
  'top-query-fingerprints',
  BOTTOM_CHART,
] as const

/** Past the slowest chart interval (VERY_SLOW_5M = 300_000). */
const STEP_MS = 301_000
const STEPS = 3
/** root margin in use-in-viewport.ts; the bottom row must be farther than this. */
const ROOT_MARGIN_PX = 200
const VIEWPORT_H = 500
/** settleCounts: unchanged for this many checks, CHECK_MS apart. */
const STABLE_CHECKS = 3
const CHECK_MS = 150

describe('Off-screen chart polling', () => {
  let counts: Record<string, number>
  /** Requests the proxy has counted whose response has not been sent yet. */
  let inFlight = 0

  const count = (name: string) => counts[name] ?? 0

  const snapshot = () => ({ ...counts })

  /**
   * Block until no response is outstanding and the request counts have not
   * changed for `STABLE_CHECKS` consecutive real-time checks, `CHECK_MS` apart
   * (proxy-side counting and slow responses lag the browser, so a fixed sleep
   * is not enough; a response still in flight would also make the next tick's
   * interval fire dedupe into it and undercount an in-view chart).
   */
  const settleCounts = (budget = 60) => {
    const read = (): string => `${JSON.stringify(counts)}|${inFlight}`
    const poll = (last: string, stable: number, left: number): void => {
      if (stable >= STABLE_CHECKS && inFlight === 0) return
      if (left <= 0) throw new Error('request counts never settled')
      cy.wait(CHECK_MS).then(() => {
        const now = read()
        poll(now, now === last ? stable + 1 : 0, left - 1)
      })
    }
    cy.then(() => poll(read(), 0, budget))
  }

  /** Advance one step past every interval, then let the fetches settle. */
  const step = () => {
    cy.tick(STEP_MS)
    settleCounts()
  }

  /**
   * Two animation frames: the IntersectionObserver notification for a scroll
   * is queued in the rendering update, so after two frames it has been
   * delivered (React then renders it on its own scheduler, not on the faked
   * timers).
   */
  const nextFrames = () =>
    cy.window().then(
      (win) =>
        new Cypress.Promise<void>((resolve) => {
          win.requestAnimationFrame(() =>
            win.requestAnimationFrame(() => resolve())
          )
        })
    )

  /**
   * Let a scroll take effect and drain the one transition fetch (a timer the
   * old viewport state left armed, or the resume refetch), unasserted.
   */
  const settleInto = () => {
    nextFrames()
    cy.wait(300)
    step()
  }

  /** Run `n` measured steps and yield the per-chart request deltas. */
  const stepsDelta = (n: number) => {
    // Snapshot when this command runs, not when the test body queues it: the
    // body queues all phases up front, long before the earlier ones execute.
    let before: Record<string, number> = {}
    settleCounts()
    cy.then(() => {
      before = snapshot()
    })
    for (let i = 0; i < n; i++) step()
    return cy.then(() => {
      const delta: Record<string, number> = {}
      for (const name of ALL_CHARTS)
        delta[name] = count(name) - (before[name] ?? 0)
      return delta
    })
  }

  /** Scroll a row's collapse button (one per row, at the row's bottom) into view. */
  const scrollToRow = (which: 'first' | 'last') => {
    cy.get('[aria-label="Collapse row"]')
      [which]()
      .scrollIntoView({
        offset: { top: -300, left: 0 },
        ensureScrollable: false,
      })
  }

  /**
   * Block (retrying) until the scroll has settled where the phase needs it:
   * `rowsInView` is the row whose button must be inside the viewport, and the
   * row-1 button must be above (or below) the margin accordingly. Asserting
   * the geometry keeps the spec honest about WHY a chart should be paused.
   */
  const settledAt = (where: 'top' | 'bottom') =>
    cy.get('[aria-label="Collapse row"]').should(($b) => {
      const first = $b[0].getBoundingClientRect()
      const last = $b[$b.length - 1].getBoundingClientRect()
      if (where === 'top') {
        expect(first.bottom, 'row 1 bottom edge').to.be.within(0, VIEWPORT_H)
        expect(last.top, 'row 4 below fold + margin').to.be.greaterThan(
          VIEWPORT_H + ROOT_MARGIN_PX + 50
        )
      } else {
        expect(last.top, 'row 4 button on screen').to.be.within(0, VIEWPORT_H)
        expect(first.bottom, 'row 1 above the margin').to.be.lessThan(
          -(ROOT_MARGIN_PX + 50)
        )
      }
    })

  /** The row buttons sit at each row's bottom edge: row N bottom y in the document. */
  const rowBottoms = () =>
    cy
      .get('[aria-label="Collapse row"]')
      .then(($b) =>
        [...$b].map((el) => el.getBoundingClientRect().bottom + window.scrollY)
      )

  beforeEach(() => {
    counts = {}
    inFlight = 0
    cy.viewport(1280, VIEWPORT_H)
    cy.intercept({ method: 'GET', pathname: '/api/v1/charts/*' }, (req) => {
      const name = new URL(req.url).pathname.split('/').pop() as string
      counts[name] = (counts[name] ?? 0) + 1
      inFlight += 1
      req.on('after:response', () => {
        inFlight -= 1
      })
      req.reply({ statusCode: 200, body: { data: [], metadata: {} } })
    })
    cy.clock(Date.now(), [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
    ])
    cy.visit(PAGE)
    // Initial fetches are never paused, so every chart reports once on mount.
    // Nudge the faked timers in small steps (see header, point 3) until they do.
    const mounted = (left: number): void => {
      if (ALL_CHARTS.every((name) => count(name) >= 1)) return
      if (left <= 0)
        throw new Error(
          `charts never made their initial fetch: ${JSON.stringify(counts)}`
        )
      // 200ms of fake time per iteration, 12s at most (the first 60
      // iterations): far below any refresh interval, enough to release a
      // throttled Suspense reveal. The rest only give a starved runner time.
      if (left > 60) cy.tick(200)
      cy.wait(250).then(() => mounted(left - 1))
    }
    cy.then(() => mounted(120))
    cy.wrap(null).should(() => {
      for (const name of ALL_CHARTS)
        expect(count(name), `initial ${name}`).to.be.gte(1)
    })
    // Let the IntersectionObserver deliver its first entries.
    nextFrames()
    cy.wait(300)
    settleCounts()
  })

  it('keeps polling in-view charts, pauses far off-screen ones, and resumes on scroll back', () => {
    // Geometry: row 4 must start farther below the fold than the root margin.
    cy.get('[aria-label="Collapse row"]').should('have.length', 4)
    rowBottoms().then((bottoms) => {
      const row3Bottom = bottoms[2]
      expect(row3Bottom, 'row 4 starts below fold + margin').to.be.greaterThan(
        VIEWPORT_H + ROOT_MARGIN_PX
      )
    })
    settledAt('top')

    // Phase 1 — scrolled to top: row 1 polls, row 4 does not.
    settleInto()
    stepsDelta(STEPS).then((delta) => {
      for (const name of TOP_CHARTS) {
        expect(delta[name], `${name} in view`).to.be.gte(STEPS - 1)
      }
      expect(delta[BOTTOM_CHART], `${BOTTOM_CHART} far off-screen`).to.equal(0)
    })

    // Phase 2 — scroll to the last row: it resumes, row 1 stops.
    scrollToRow('last')
    settledAt('bottom')
    settleInto()
    stepsDelta(STEPS).then((delta) => {
      expect(delta[BOTTOM_CHART], `${BOTTOM_CHART} back in view`).to.be.gte(
        STEPS - 1
      )
      for (const name of TOP_CHARTS) {
        expect(delta[name], `${name} scrolled away`).to.equal(0)
      }
    })

    // Phase 3 — back to the top: row 1 resumes, row 4 stops again.
    cy.scrollTo('top', { ensureScrollable: false })
    settledAt('top')
    settleInto()
    stepsDelta(STEPS).then((delta) => {
      for (const name of TOP_CHARTS) {
        expect(delta[name], `${name} resumed`).to.be.gte(STEPS - 1)
      }
      expect(delta[BOTTOM_CHART], `${BOTTOM_CHART} paused again`).to.equal(0)
    })
  })
})
