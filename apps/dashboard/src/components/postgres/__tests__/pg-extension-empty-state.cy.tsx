/**
 * Cypress component test for the Postgres extension-missing empty state
 * (issue #2450).
 *
 * WHY: when the `pg_stat_statements` extension is not installed, the Query
 * Insights page must render a graceful, actionable empty state — never a raw
 * Postgres error. This asserts the user-facing contract in a real DOM: the
 * extension name is shown and the enable instructions (`shared_preload_libraries`
 * + `CREATE EXTENSION`) are present so an operator knows exactly what to do.
 */

import { PgExtensionEmptyState } from '../pg-extension-empty-state'

describe('PgExtensionEmptyState', () => {
  it('names the extension and shows the enable steps', () => {
    cy.mount(<PgExtensionEmptyState extension="pg_stat_statements" />)

    // Title calls out the specific missing extension.
    cy.contains('pg_stat_statements').should('be.visible')
    cy.contains(/is not installed/i).should('be.visible')

    // The enable instructions are present and complete.
    cy.get('[data-testid="pg-extension-enable-steps"]').within(() => {
      cy.contains('shared_preload_libraries').should('exist')
      cy.contains('CREATE EXTENSION pg_stat_statements').should('exist')
    })
  })

  it('renders for an arbitrary extension name', () => {
    cy.mount(<PgExtensionEmptyState extension="pg_buffercache" />)
    cy.contains('CREATE EXTENSION pg_buffercache').should('exist')
  })
})
