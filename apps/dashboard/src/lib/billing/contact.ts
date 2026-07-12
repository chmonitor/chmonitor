/**
 * Single source of truth for the sales contact used by the non-self-serve
 * (Enterprise / dedicated instance) paths: the billing page plan grid and the
 * paywall modal's "Contact us" action. Keep the address here — never inline it
 * at a call site — so it changes in exactly one place.
 */

/** Address prospects email about Enterprise / dedicated instances. */
export const SALES_CONTACT_EMAIL = 'hi@anyrouter.dev'

/** `mailto:` href with a prefilled subject. */
export function salesContactMailto(
  subject = 'chmonitor Enterprise — dedicated instance'
): string {
  return `mailto:${SALES_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`
}
