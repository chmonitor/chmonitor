import type { PublicFeaturePermissionConfig } from '@/lib/feature-permissions/types'

import { metadataDbSatisfied } from './metadata-db'
import { describe, expect, it } from 'bun:test'

const baseConfig: PublicFeaturePermissionConfig = {
  authProvider: 'none',
  principal: 'anonymous',
  features: {},
}

describe('metadataDbSatisfied', () => {
  it('passes items without the flag regardless of config', () => {
    expect(metadataDbSatisfied({}, baseConfig)).toBe(true)
    expect(
      metadataDbSatisfied(
        {},
        { ...baseConfig, metadataDb: { available: false } }
      )
    ).toBe(true)
  })

  it('dims flagged items only when the server reports no metadata DB', () => {
    expect(
      metadataDbSatisfied(
        { requiresMetadataDb: true },
        { ...baseConfig, metadataDb: { available: false } }
      )
    ).toBe(false)
    expect(
      metadataDbSatisfied(
        { requiresMetadataDb: true },
        { ...baseConfig, metadataDb: { available: true } }
      )
    ).toBe(true)
  })

  it('fails open when the config has no metadataDb block (older server / fetch error)', () => {
    expect(metadataDbSatisfied({ requiresMetadataDb: true }, baseConfig)).toBe(
      true
    )
  })
})
