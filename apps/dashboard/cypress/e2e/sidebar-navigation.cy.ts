/// <reference types="cypress" />

/**
 * Sidebar navigation smoke tests.
 *
 * Verifies the sidebar menu renders with key sections and that
 * clicking a nav link updates the URL while preserving the host parameter.
 *
 * The app uses shadcn/ui Sidebar which renders a <div> with two attributes:
 * data-sidebar="sidebar" and data-slot="sidebar-inner". Selectors target this
 * container via data-sidebar="sidebar" (not <nav> — there is no nav element).
 * Links use TanStack Router's Link component with `to` + `search` props which
 * renders the correct href (e.g. /running-queries?host=0) on the <a> element.
 *
 * Below `lg` (1024px) the rail is a closed Sheet overlay, so the docked
 * `[data-sidebar="sidebar"]` node is not in the DOM until the trigger opens
 * it. These specs pin a desktop viewport so they exercise the docked rail
 * they were written for. Cypress's default 1000px viewport is below `lg`.
 */

// Sidebar links live inside the shadcn/ui Sidebar inner container.
// The element has data-sidebar="sidebar" and data-slot="sidebar-inner".
const SIDEBAR = '[data-sidebar="sidebar"]'
const SIDEBAR_TRIGGER = '[data-slot="sidebar-trigger"]'
const SIDEBAR_GROUP = '[data-slot="sidebar"]'
const SIDEBAR_CONTENT = '[data-sidebar="content"]'

/**
 * Nested groups render as a Popover portal when the rail is icon-collapsed
 * (`useSidebar().state === 'collapsed'`). Nested `a` tags then live outside
 * `[data-sidebar="sidebar"]`. Cookie `sidebar_state` is write-only, so a
 * prior spec that clicked the trigger can leave this visit collapsed.
 */
function ensureDesktopRailExpanded() {
  // data-state lives on the desktop group (`data-slot="sidebar"`), not the
  // wrapper. Yield is the attribute string after should('have.attr').
  cy.get(SIDEBAR_GROUP)
    .should('have.attr', 'data-state')
    .then((state) => {
      if (state === 'collapsed') {
        cy.get(SIDEBAR_TRIGGER).first().click()
      }
    })
  cy.get(SIDEBAR_GROUP).should('have.attr', 'data-state', 'expanded')
}

/**
 * Scroll `el` inside the sidebar content pane so Queries/Cluster sit above
 * SidebarFooter. Window `scrollIntoView` can move the page; only the pane
 * should move.
 */
function scrollWithinSidebarContent(el: HTMLElement) {
  const pane = el.closest(SIDEBAR_CONTENT) as HTMLElement | null
  if (!pane) return
  const elRect = el.getBoundingClientRect()
  const paneRect = pane.getBoundingClientRect()
  pane.scrollTop += elRect.top - paneRect.top - 8
}

function clickCoveredIfNeeded($el: JQuery<HTMLElement>) {
  scrollWithinSidebarContent($el[0])
  // About footer can still cover the last groups after scroll.
  cy.wrap($el).click({ force: true })
}

/**
 * Expand a collapsible sidebar group only when the target link is missing
 * or hidden. Unconditionally clicking the group toggles it: if the group is
 * already open, the click collapses it and the links unmount.
 *
 * Match the group trigger by exact visible text on `[data-sidebar="menu-button"]`
 * (or the collapsible trigger). `cy.contains('Queries')` substring-matches
 * child titles ("Running Queries") and may click a hidden CollapsibleContent
 * node instead of expanding the group. Requery after the snapshot check so we
 * do not chain contains() on a detached $sidebar wrap.
 */
function expandGroupIfNeeded(groupLabel: string, hrefPart: string) {
  const exactLabel = new RegExp(`^${groupLabel}$`)

  cy.get(SIDEBAR).then(($sidebar) => {
    const $visible = $sidebar.find(`a[href*="${hrefPart}"]`).filter(':visible')
    if ($visible.length > 0) {
      return
    }

    // Requery — do not chain off the stale $sidebar snapshot.
    cy.get(
      `${SIDEBAR} [data-sidebar="menu-button"], ${SIDEBAR} [data-slot="collapsible-trigger"]`
    )
      .filter((_, el) =>
        exactLabel.test((el.innerText || '').replace(/\s+/g, ' ').trim())
      )
      .should('have.length.at.least', 1)
      .first()
      .then(($btn) => {
        clickCoveredIfNeeded($btn)
      })
  })
}

/**
 * Click the target href after expand. Prefer the in-rail SIDEBAR link;
 * nested items can render in a popover portal (outside the rail) when the
 * sidebar is icon-collapsed. Requery so Cypress does not click a detached node.
 */
function clickVisibleHref(hrefPart: string) {
  const railSel = `${SIDEBAR} a[href*="${hrefPart}"]`
  const portalSel = `[data-slot="popover-content"] a[href*="${hrefPart}"]`

  cy.get('body', { timeout: 10000 }).should(($body) => {
    const rail = $body.find(railSel).filter(':visible').length
    const portal = $body.find(portalSel).filter(':visible').length
    expect(
      rail + portal,
      `visible ${hrefPart} in sidebar rail or popover`
    ).to.be.greaterThan(0)
  })

  cy.get('body').then(($body) => {
    if ($body.find(railSel).filter(':visible').length > 0) {
      cy.get(railSel)
        .filter(':visible')
        .first()
        .then(($a) => {
          clickCoveredIfNeeded($a)
        })
      return
    }
    cy.get(`a[href*="${hrefPart}"]`)
      .filter(':visible')
      .first()
      .then(($a) => {
        clickCoveredIfNeeded($a)
      })
  })
}

describe('Sidebar navigation', () => {
  beforeEach(() => {
    // Docked rail starts at `lg` (1024). Stay well above that so the first
    // paint is already the persistent sidebar, not the overlay sheet.
    cy.viewport(1280, 720)
    cy.visit('/overview?host=0')
    ensureDesktopRailExpanded()
  })

  it('renders the sidebar with navigation links', () => {
    cy.get(SIDEBAR).should('exist')
    cy.get(`${SIDEBAR} a`).should('have.length.greaterThan', 0)
  })

  it('preserves host parameter when clicking a sidebar link', () => {
    // Find a sidebar link that isn't the current page (overview)
    cy.get(`${SIDEBAR} a[href*="host="]`)
      .not('[href*="/overview"]')
      .first()
      .then(($link) => {
        cy.wrap($link).click()
        cy.url().should('include', 'host=0')
        // URL should have changed from /overview
        cy.url().should('not.include', '/overview')
      })
  })

  it('navigates to running-queries via sidebar', () => {
    cy.get(SIDEBAR).should('be.visible')
    expandGroupIfNeeded('Queries', '/running-queries')
    clickVisibleHref('/running-queries')
    cy.url().should('include', '/running-queries')
    cy.url().should('include', 'host=0')
    cy.get('body').should('exist')
  })

  it('navigates to clusters via sidebar', () => {
    cy.get(SIDEBAR).should('be.visible')
    expandGroupIfNeeded('Cluster', '/clusters')
    clickVisibleHref('/clusters')
    cy.url().should('include', '/clusters')
    cy.url().should('include', 'host=0')
    cy.get('body').should('exist')
  })
})

describe('Sidebar overlay below lg', () => {
  it('opens the sheet from the header trigger', () => {
    // Cypress default (1000x660) is below lg, so the rail is a closed Sheet.
    cy.viewport(1000, 660)
    cy.visit('/overview?host=0')
    cy.get(SIDEBAR).should('not.exist')
    cy.get(SIDEBAR_TRIGGER).should('exist').click()
    cy.get(SIDEBAR).should('be.visible')
    cy.get(`${SIDEBAR} a`).should('have.length.greaterThan', 0)
  })
})
