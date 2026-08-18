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

const USER_SETTINGS_STORAGE_KEY = 'clickhouse-monitor-user-settings'
const E2E_USER_SETTINGS = {
  dimUnavailablePages: true,
  workspacePreset: 'full',
  hiddenMenuHrefs: [] as string[],
}

function seedUserSettings(win: Window) {
  win.localStorage.removeItem(USER_SETTINGS_STORAGE_KEY)
  win.localStorage.setItem(
    USER_SETTINGS_STORAGE_KEY,
    JSON.stringify(E2E_USER_SETTINGS)
  )
}

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

function expandGroup(groupLabel: string, hrefPart: string) {
  const labelRe = new RegExp(`^${groupLabel}(\\s|$)`)
  cy.get(`${SIDEBAR} [data-slot="collapsible-trigger"]`)
    .filter((_, el) =>
      labelRe.test((el.innerText || '').replace(/\s+/g, ' ').trim())
    )
    .should('have.length.at.least', 1)
    .first()
    .scrollIntoView()
    .click({ force: true })

  cy.get('body').then(($body) => {
    if ($body.find(`a[href*="${hrefPart}"]`).length === 0) {
      // First click collapsed an already-open group — toggle back.
      cy.get(`${SIDEBAR} [data-slot="collapsible-trigger"]`)
        .filter((_, el) =>
          labelRe.test((el.innerText || '').replace(/\s+/g, ' ').trim())
        )
        .first()
        .click({ force: true })
    }
  })

  cy.get(`a[href*="${hrefPart}"]`, { timeout: 10000 }).should('exist')
}

function clickHref(hrefPart: string) {
  cy.get(`a[href*="${hrefPart}"]`).first().click({ force: true })
}

describe('Sidebar navigation', () => {
  beforeEach(() => {
    // Docked rail starts at `lg` (1024). Stay well above that so the first
    // paint is already the persistent sidebar, not the overlay sheet.
    cy.viewport(1280, 720)
    cy.visit('/overview?host=0', {
      onBeforeLoad(win) {
        seedUserSettings(win)
      },
    })
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
    expandGroup('Queries', '/running-queries')
    clickHref('/running-queries')
    cy.url().should('include', '/running-queries')
    cy.url().should('include', 'host=0')
    cy.get('body').should('exist')
  })

  it('navigates to sql console via Tools sidebar group', () => {
    // Tools is the last Main group (composed after Logs in menu/index.ts).
    // expandGroup scrolls it into view — do not assume it is near the top.
    cy.get(SIDEBAR).should('be.visible')
    expandGroup('Tools', '/sql')
    clickHref('/sql')
    cy.url().should('include', '/sql')
    cy.url().should('include', 'host=0')
    cy.get('body').should('exist')
  })

  it('navigates to clusters via sidebar', () => {
    cy.get(SIDEBAR).should('be.visible')
    expandGroup('Cluster', '/clusters')
    clickHref('/clusters')
    cy.url().should('include', '/clusters')
    cy.url().should('include', 'host=0')
    cy.get('body').should('exist')
  })
})

describe('Sidebar overlay below lg', () => {
  it('opens the sheet from the header trigger', () => {
    // Cypress default (1000x660) is below lg, so the rail is a closed Sheet.
    cy.viewport(1000, 660)
    cy.visit('/overview?host=0', {
      onBeforeLoad(win) {
        seedUserSettings(win)
      },
    })
    cy.get(SIDEBAR).should('not.exist')
    cy.get(SIDEBAR_TRIGGER).should('exist').click()
    cy.get(SIDEBAR).should('be.visible')
    cy.get(`${SIDEBAR} a`).should('have.length.greaterThan', 0)
  })
})
