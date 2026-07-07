// Loaded automatically before every E2E spec.
//
// Suppresses expected errors that occur when the Node CI server runs without a
// real ClickHouse connection (connection refused, timeout, etc.). The page-render
// sweep spec collects errors per-route and reports them in bulk; other specs
// use individual `cy.on('uncaught:exception')` handlers as needed.

import { addClerkCommands } from '@clerk/testing/cypress'

addClerkCommands({ Cypress, cy })

Cypress.on('uncaught:exception', (err) => {
  const msg = err.message || ''

  // ClickHouse connection failures — expected when no CH server is available.
  if (
    msg.includes('ECONNREFUSED') ||
    msg.includes('fetch failed') ||
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('NetConnectRefuseError') ||
    msg.includes('timeout')
  ) {
    return false
  }

  // React hydration mismatches in prerendered HTML — cosmetic, not functional.
  if (
    msg.includes('Hydration') ||
    msg.includes('hydration') ||
    msg.includes('Minified React error #418') ||
    msg.includes('Minified React error #419') ||
    msg.includes('Minified React error #421') ||
    msg.includes('Minified React error #423') ||
    msg.includes('Minified React error #425')
  ) {
    return false
  }

  // Let other errors surface.
  return true
})
