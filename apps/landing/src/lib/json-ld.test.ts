import { freeOffer } from './json-ld'
import { describe, expect, test } from 'bun:test'

// Google Search Console flags Product structured data without these offer
// fields as Merchant listings issues — keep them all present on the shared
// offer so every Product JSON-LD (Base, use-case pages, /cli) stays valid.
describe('freeOffer JSON-LD', () => {
  test('is a free USD offer marked in stock', () => {
    expect(freeOffer['@type']).toBe('Offer')
    expect(freeOffer.price).toBe('0')
    expect(freeOffer.priceCurrency).toBe('USD')
    expect(freeOffer.availability).toBe('https://schema.org/InStock')
  })

  test('declares free instant shipping', () => {
    const shipping = freeOffer.shippingDetails
    expect(shipping['@type']).toBe('OfferShippingDetails')
    expect(shipping.shippingRate.value).toBe('0')
    expect(shipping.shippingDestination.addressCountry).toBeTruthy()
    expect(shipping.deliveryTime.transitTime.maxValue).toBe(0)
  })

  test('declares a merchant return policy', () => {
    const policy = freeOffer.hasMerchantReturnPolicy
    expect(policy['@type']).toBe('MerchantReturnPolicy')
    expect(policy.applicableCountry).toBeTruthy()
    expect(policy.returnPolicyCategory).toContain('schema.org/MerchantReturn')
  })
})
