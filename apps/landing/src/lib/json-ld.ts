// Shared "free download" Offer for the Product JSON-LD emitted on landing
// pages. Google Merchant listings requires availability + shippingDetails +
// hasMerchantReturnPolicy inside `offers` even for a $0 digital download:
// shipping is instant and free, and there is nothing to return.
export const freeOffer = {
  '@type': 'Offer',
  price: '0',
  priceCurrency: 'USD',
  availability: 'https://schema.org/InStock',
  shippingDetails: {
    '@type': 'OfferShippingDetails',
    shippingRate: { '@type': 'MonetaryAmount', value: '0', currency: 'USD' },
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      handlingTime: {
        '@type': 'QuantitativeValue',
        minValue: 0,
        maxValue: 0,
        unitCode: 'DAY',
      },
      transitTime: {
        '@type': 'QuantitativeValue',
        minValue: 0,
        maxValue: 0,
        unitCode: 'DAY',
      },
    },
  },
  hasMerchantReturnPolicy: {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: 'US',
    returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
  },
} as const
