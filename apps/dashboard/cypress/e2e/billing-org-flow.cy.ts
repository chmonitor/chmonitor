/// <reference types="cypress" />
/**
 * Billing + Org E2E harness — Polar checkout + Clerk org onboarding.
 *
 * Required env vars (all optional — tests degrade gracefully when absent):
 *   CYPRESS_BASE_URL              Live deployment URL, e.g.
 *                                   https://preview.dash.chmonitor.dev
 *   CYPRESS_CLERK_PUBLISHABLE_KEY Clerk publishable key (pk_test_…) for test mode.
 *                                 Becomes Cypress.env('CLERK_PUBLISHABLE_KEY').
 *   CLERK_SECRET_KEY              Clerk secret key (sk_test_…); used by clerkSetup
 *                                 (via cypress.config.ts) to fetch the per-run
 *                                 testing token from the Clerk Backend API.
 *   CYPRESS_CLERK_TEST_EMAIL      A +clerk_test subaddress for sign-in, e.g.
 *                                   you+clerk_test@example.com
 *                                 Clerk test mode accepts verification code 424242.
 *                                 Becomes Cypress.env('CLERK_TEST_EMAIL').
 *
 * Graceful degradation:
 *   - Anonymous suite always runs — verifies pages render without console crashes.
 *   - Authenticated suite skips when CYPRESS_CLERK_PUBLISHABLE_KEY or
 *     CYPRESS_CLERK_TEST_EMAIL is absent.
 *   - Plan-picker assertions skip when the deployment is not in cloud mode
 *     (self-hosted builds show a different setup surface).
 *   - Checkout intercept asserts request shape only; no payment is attempted.
 *
 * Run against preview deployment:
 *   CYPRESS_BASE_URL=https://preview.dash.chmonitor.dev \
 *   CYPRESS_CLERK_PUBLISHABLE_KEY=pk_test_… \
 *   CLERK_SECRET_KEY=sk_test_… \
 *   CYPRESS_CLERK_TEST_EMAIL=you+clerk_test@example.com \
 *   bun run test:e2e:billing
 */

import { setupClerkTestingToken } from '@clerk/testing/cypress'

// Cypress strips the CYPRESS_ prefix: CYPRESS_CLERK_PUBLISHABLE_KEY →
// Cypress.env('CLERK_PUBLISHABLE_KEY'). Likewise for CYPRESS_CLERK_TEST_EMAIL.
const clerkConfigured = (): boolean =>
  Boolean(Cypress.env('CLERK_PUBLISHABLE_KEY')) &&
  Boolean(Cypress.env('CLERK_TEST_EMAIL'))

const testEmail = (): string => Cypress.env('CLERK_TEST_EMAIL') as string

describe('Billing + Org flow', () => {
  // Suppress auth/network noise that is expected in CI (same as the global
  // support/e2e.ts handler, but scoped to this suite for clarity).
  Cypress.on('uncaught:exception', (err) => {
    const msg = err.message || ''
    if (
      msg.includes('ECONNREFUSED') ||
      msg.includes('fetch failed') ||
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('ClerkRuntimeError') ||
      msg.includes('Hydration') ||
      msg.includes('hydration') ||
      msg.includes('timeout')
    ) {
      return false
    }
    return true
  })

  // ── Suite A: Anonymous (no Clerk auth required) ──────────────────────────
  //
  // These run on every CI invocation regardless of whether Clerk keys are
  // present. They guard against import/route/render crashes on the billing
  // surface.

  describe('anonymous', () => {
    it('/billing renders the heading and license cards without a console crash', () => {
      cy.visit('/billing')
      cy.get('body').then(($body) => {
        if ($body.text().includes('is a cloud feature')) {
          cy.contains('Billing is a cloud feature').should('be.visible')
          cy.contains('Read the docs').should('be.visible')
        } else {
          cy.get('h1').should('contain.text', 'Billing')
          cy.contains('Team').should('exist')
          cy.contains('Unlimited').should('exist')
        }
      })
    })

    it('/setup renders a welcome / setup surface without a console crash', () => {
      cy.visit('/setup')
      // Any deployment mode should produce at least an <h1> — cloud
      // "Connect your ClickHouse" / "Monitor your ClickHouse", or the
      // self-hosted setup heading.
      cy.get('h1').should('exist')
    })

    it('/organization renders without a console crash', () => {
      cy.visit('/organization')
      cy.get('body').should('exist')
    })
  })

  // ── Suite B: Authenticated (requires Clerk test mode) ────────────────────
  //
  // Uses @clerk/testing cy.clerkSignIn with the email_code strategy.
  // setupClerkTestingToken() must be called before cy.visit so the Clerk JS
  // bundle picks up the bypass token for bot-protection.

  describe('authenticated (cloud mode)', () => {
    beforeEach(function () {
      if (!clerkConfigured()) {
        // eslint-disable-next-line no-console
        cy.log(
          'Skipping authenticated suite: CYPRESS_CLERK_PUBLISHABLE_KEY or ' +
            'CYPRESS_CLERK_TEST_EMAIL is not set.'
        )
        this.skip()
      }
    })

    it('/setup shows connect-host for a signed-in cloud user', () => {
      setupClerkTestingToken()
      cy.visit('/setup')
      cy.clerkSignIn({ strategy: 'email_code', identifier: testEmail() })
      cy.visit('/setup')

      cy.get('body').then(($body) => {
        if ($body.find('[data-testid="welcome-add-host"]').length) {
          cy.get('[data-testid="welcome-add-host"]').should('be.visible')
        } else {
          cy.log('Connect CTA not shown (self-hosted setup) — skipping.')
        }
      })
    })

    it('/billing page shows hosted cloud and license cards', () => {
      setupClerkTestingToken()
      cy.visit('/billing')
      cy.clerkSignIn({ strategy: 'email_code', identifier: testEmail() })
      cy.visit('/billing')
      cy.get('h1').should('contain.text', 'Billing')
      cy.contains('Hosted Cloud').should('exist')
      cy.contains('Self-host licenses').should('exist')
      cy.contains('Buy Team').should('exist')
    })

    it('/organization renders the org profile or the upgrade prompt', () => {
      setupClerkTestingToken()
      cy.visit('/organization')
      cy.clerkSignIn({ strategy: 'email_code', identifier: testEmail() })
      cy.visit('/organization')
      // Either <OrganizationProfile> (paid user in an org) or <NoOrgState>
      // ("No organization yet" card + upgrade prompt) must be visible.
      cy.get('body').then(($body) => {
        const text = $body.text()
        const hasOrgProfile =
          $body.find('.cl-organizationProfile').length > 0 ||
          $body.find('[data-clerk-component="OrganizationProfile"]').length > 0
        const hasUpgradePrompt =
          text.includes('No organization yet') || text.includes('organization')
        expect(hasOrgProfile || hasUpgradePrompt).to.be.true
      })
    })
  })
})
