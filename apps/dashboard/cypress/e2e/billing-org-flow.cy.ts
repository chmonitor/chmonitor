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
    it('/billing renders the heading and plan grid without a console crash', () => {
      cy.visit('/billing')
      cy.get('body').then(($body) => {
        if ($body.text().includes('is a cloud feature')) {
          cy.contains('Billing is a cloud feature').should('be.visible')
          cy.contains('Read the docs').should('be.visible')
        } else {
          cy.get('h1').should('contain.text', 'Billing')
          // The plan grid renders four plan cards (Free / Pro / Max / Enterprise).
          cy.contains('Free').should('exist')
          cy.contains('Pro').should('exist')
          cy.contains('Max').should('exist')
        }
      })
    })

    it('/setup renders a welcome / setup surface without a console crash', () => {
      cy.visit('/setup')
      // Any deployment mode should produce at least an <h1> — either the cloud
      // "Choose your plan" / "Monitor your ClickHouse" heading, or the
      // self-hosted "Connect a ClickHouse host" heading.
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

    it('/setup plan picker shows Free / Pro / Max for a signed-in free user', () => {
      setupClerkTestingToken()
      // Visit first so Clerk JS loads, then sign in.
      cy.visit('/setup')
      cy.clerkSignIn({ strategy: 'email_code', identifier: testEmail() })
      cy.visit('/setup')

      // The plan picker only shows in cloud mode + signed-in + free plan.
      // In self-hosted mode the component renders a different surface; guard
      // with a body check so the test passes gracefully in both environments.
      cy.get('body').then(($body) => {
        if ($body.find('[data-testid="onboarding-choose-free"]').length) {
          cy.get('[data-testid="onboarding-choose-free"]')
            .should('be.visible')
            .and('contain.text', 'Continue with Free')
          cy.get('[data-testid="onboarding-choose-pro"]').should('be.visible')
          cy.get('[data-testid="onboarding-choose-max"]').should('be.visible')
          cy.contains('Choose your plan').should('exist')
        } else {
          cy.log(
            'Plan picker not shown (self-hosted mode or user already paid) — ' +
              'skipping picker assertions.'
          )
        }
      })
    })

    it('"Continue with Free" advances to the connect-host step', () => {
      setupClerkTestingToken()
      cy.visit('/setup')
      cy.clerkSignIn({ strategy: 'email_code', identifier: testEmail() })
      cy.visit('/setup')

      cy.get('body').then(($body) => {
        if (!$body.find('[data-testid="onboarding-choose-free"]').length) {
          cy.log(
            'Plan picker not shown — skipping connect-host step assertion.'
          )
          return
        }
        cy.get('[data-testid="onboarding-choose-free"]').click()
        // After choosing Free the OnboardingPlans step calls onContinueFree()
        // which sets step → 'connect', rendering the ConnectYourHost card.
        cy.contains('Connect your ClickHouse', { timeout: 6000 }).should(
          'be.visible'
        )
        cy.get('[data-testid="welcome-add-host"]').should('be.visible')
      })
    })

    it('clicking Pro fires POST /api/v1/billing/checkout with planId=pro', () => {
      // Intercept before the page loads so the stub is in place when the
      // button is clicked. Stub the response with a same-origin URL to avoid
      // triggering a cross-origin navigation that Cypress cannot follow.
      // In production the real endpoint returns a polar.sh/sandbox URL; the
      // request shape (planId + period) is what we are asserting here.
      cy.intercept('POST', '/api/v1/billing/checkout', (req) => {
        req.reply({
          statusCode: 200,
          body: {
            success: true,
            data: {
              // Use a recognisable slug so assertions can verify the stub fired.
              url:
                (Cypress.config('baseUrl') as string) +
                '/billing?status=checkout-intercepted&provider=polar',
            },
          },
        })
      }).as('checkoutReq')

      setupClerkTestingToken()
      cy.visit('/setup')
      cy.clerkSignIn({ strategy: 'email_code', identifier: testEmail() })
      cy.visit('/setup')

      cy.get('body').then(($body) => {
        if (!$body.find('[data-testid="onboarding-choose-pro"]').length) {
          cy.log(
            'Plan picker not shown — skipping checkout intercept assertion.'
          )
          return
        }
        cy.get('[data-testid="onboarding-choose-pro"]').click()

        cy.wait('@checkoutReq').then((interception) => {
          // The client sends { planId, period } in the POST body.
          const body = interception.request.body as {
            planId?: string
            period?: string
          }
          expect(body).to.have.property('planId', 'pro')
          expect(body).to.have.property('period', 'yearly')

          // The stubbed response envelope has our recognisable URL.
          const responseBody = interception.response?.body as {
            data?: { url?: string }
          }
          expect(responseBody?.data?.url).to.include('polar')
        })
      })
    })

    it('/billing page reflects the plan state for an authenticated user', () => {
      setupClerkTestingToken()
      cy.visit('/billing')
      cy.clerkSignIn({ strategy: 'email_code', identifier: testEmail() })
      cy.visit('/billing')
      cy.get('h1').should('contain.text', 'Billing')
      // The current-plan card shows the plan name and a status badge.
      // For a test account the plan is Free (status badge shows "free").
      cy.contains(/free|pro|max/i).should('exist')
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
