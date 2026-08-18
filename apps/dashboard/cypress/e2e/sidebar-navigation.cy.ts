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

describe('Sidebar navigation', () => {
  beforeEach(() => {
    // Docked rail starts at `lg` (1024). Stay well above that so the first
    // paint is already the persistent sidebar, not the overlay sheet.
    cy.viewport(1280, 720)
    cy.visit('/overview?host=0')
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
    // Expand the "Queries" group menu
    cy.get(SIDEBAR).contains('button', 'Queries').click()
    // Use should('be.visible') instead of :visible CSS pseudo-selector for
    // more reliable visibility detection in headless Electron with Radix UI
    // collapsible animations.
    cy.get('a[href*="/running-queries"]', { timeout: 10000 })
      .should('be.visible')
      .first()
      .click()
    cy.url().should('include', '/running-queries')
    cy.url().should('include', 'host=0')
    cy.get('body').should('exist')
  })

  it('navigates to clusters via sidebar', () => {
    cy.get(SIDEBAR).should('be.visible')
    // Expand the "Cluster" group menu
    cy.get(SIDEBAR).contains('button', 'Cluster').click()
    cy.get('a[href*="/clusters"]', { timeout: 10000 })
      .should('be.visible')
      .first()
      .click()
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
