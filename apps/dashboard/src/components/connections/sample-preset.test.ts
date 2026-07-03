import { isSampleClusterHost, SAMPLE_CLUSTER_PRESET } from './sample-preset'
import { describe, expect, it } from 'bun:test'

describe('SAMPLE_CLUSTER_PRESET', () => {
  it('is a valid, non-secret https connection preset', () => {
    expect(SAMPLE_CLUSTER_PRESET.name.length).toBeGreaterThan(0)
    expect(() => new URL(SAMPLE_CLUSTER_PRESET.host)).not.toThrow()
    expect(new URL(SAMPLE_CLUSTER_PRESET.host).protocol).toBe('https:')
    expect(SAMPLE_CLUSTER_PRESET.user.length).toBeGreaterThan(0)
    // Genuinely non-secret: the whole point is that this is safe to embed.
    expect(SAMPLE_CLUSTER_PRESET.password).toBe('')
  })
})

describe('isSampleClusterHost', () => {
  it('matches the exact preset host', () => {
    expect(isSampleClusterHost(SAMPLE_CLUSTER_PRESET.host)).toBe(true)
  })

  it('matches when the value has incidental surrounding whitespace', () => {
    expect(isSampleClusterHost(`  ${SAMPLE_CLUSTER_PRESET.host}  `)).toBe(true)
  })

  it('does not match a different host', () => {
    expect(isSampleClusterHost('https://clickhouse.example.com:8443')).toBe(
      false
    )
  })

  it('does not match an empty string', () => {
    expect(isSampleClusterHost('')).toBe(false)
  })
})
