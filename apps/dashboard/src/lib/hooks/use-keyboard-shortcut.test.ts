import { matchesKeyboardShortcut } from './use-keyboard-shortcut'
import { describe, expect, it } from 'bun:test'

type EventLike = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

const evt = (over: Partial<EventLike> = {}): EventLike => ({
  key: 'g',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
})

describe('matchesKeyboardShortcut', () => {
  it('matches when no modifiers are required and none are held', () => {
    expect(matchesKeyboardShortcut(evt(), { key: 'g' })).toBe(true)
  })

  it('does NOT match a no-modifier shortcut when a modifier is held', () => {
    expect(matchesKeyboardShortcut(evt({ metaKey: true }), { key: 'g' })).toBe(
      false
    )
    expect(matchesKeyboardShortcut(evt({ ctrlKey: true }), { key: 'g' })).toBe(
      false
    )
  })

  it('is case-insensitive on the key', () => {
    expect(matchesKeyboardShortcut(evt({ key: 'G' }), { key: 'g' })).toBe(true)
  })

  describe('meta-only shortcut', () => {
    const opts = { key: 'g', metaKey: true }

    it('matches when only meta is held', () => {
      expect(matchesKeyboardShortcut(evt({ metaKey: true }), opts)).toBe(true)
    })

    it('does NOT match with no modifier (regression: previously fired)', () => {
      expect(matchesKeyboardShortcut(evt(), opts)).toBe(false)
    })

    it('does NOT match when only ctrl is held', () => {
      expect(matchesKeyboardShortcut(evt({ ctrlKey: true }), opts)).toBe(false)
    })
  })

  describe('ctrl-only shortcut', () => {
    const opts = { key: 'g', ctrlKey: true }

    it('matches when only ctrl is held', () => {
      expect(matchesKeyboardShortcut(evt({ ctrlKey: true }), opts)).toBe(true)
    })

    it('does NOT match with no modifier', () => {
      expect(matchesKeyboardShortcut(evt(), opts)).toBe(false)
    })

    it('does NOT match when only meta is held', () => {
      expect(matchesKeyboardShortcut(evt({ metaKey: true }), opts)).toBe(false)
    })
  })

  describe('cross-platform meta+ctrl shortcut (Cmd on mac / Ctrl on win)', () => {
    const opts = { key: 'g', metaKey: true, ctrlKey: true }

    it('matches when meta is held (mac)', () => {
      expect(matchesKeyboardShortcut(evt({ metaKey: true }), opts)).toBe(true)
    })

    it('matches when ctrl is held (win/linux)', () => {
      expect(matchesKeyboardShortcut(evt({ ctrlKey: true }), opts)).toBe(true)
    })

    it('does NOT match when neither is held', () => {
      expect(matchesKeyboardShortcut(evt(), opts)).toBe(false)
    })
  })

  describe('shift / alt are matched exactly', () => {
    it('requires shift when requested', () => {
      const opts = { key: 'g', shiftKey: true }
      expect(matchesKeyboardShortcut(evt({ shiftKey: true }), opts)).toBe(true)
      expect(matchesKeyboardShortcut(evt(), opts)).toBe(false)
    })

    it('forbids shift when not requested', () => {
      expect(
        matchesKeyboardShortcut(evt({ shiftKey: true }), { key: 'g' })
      ).toBe(false)
    })

    it('requires alt when requested', () => {
      const opts = { key: 'g', altKey: true }
      expect(matchesKeyboardShortcut(evt({ altKey: true }), opts)).toBe(true)
      expect(matchesKeyboardShortcut(evt(), opts)).toBe(false)
    })
  })
})
