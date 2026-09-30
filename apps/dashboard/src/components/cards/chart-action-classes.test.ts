import { chartActionClass } from './chart-action-classes'
import { describe, expect, it } from 'bun:test'

describe('chartActionClass', () => {
  // Hover does not exist on touch: an action that is opacity-0 until hover can
  // never be found or tapped on a phone.
  it('never hides the action on coarse pointers', () => {
    for (const opts of [
      {},
      { alwaysVisible: true },
      { emphasis: true },
      { alwaysVisible: true, emphasis: true },
    ]) {
      const tokens = chartActionClass(opts).split(/\s+/)
      expect(tokens).not.toContain('opacity-0')
      expect(tokens.some((t) => t.startsWith('opacity-'))).toBe(true)
    }
  })

  it('keeps hover-reveal for fine pointers only', () => {
    const tokens = chartActionClass().split(/\s+/)
    expect(tokens).toContain('pointer-fine:opacity-0')
    expect(tokens).toContain('pointer-fine:group-hover:opacity-40')
    expect(tokens).toContain('pointer-fine:group-focus-within:opacity-40')
  })

  it('has no hover-reveal when always visible', () => {
    expect(chartActionClass({ alwaysVisible: true })).not.toContain(
      'pointer-fine'
    )
  })

  it('grows to a 36px hit target on coarse pointers', () => {
    expect(chartActionClass().split(/\s+/)).toContain('pointer-coarse:size-9')
  })
})
