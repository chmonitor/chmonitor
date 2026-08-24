import {
  friendlyNoteToHtml,
  loadLandingFriendlyNotes,
} from './load-friendly-notes'
import { describe, expect, test } from 'bun:test'

describe('loadLandingFriendlyNotes', () => {
  test('loads seeded 0.3.x notes from docs/whats-new', () => {
    const notes = loadLandingFriendlyNotes()
    const v033 = notes.get('v0.3.3') ?? notes.get('0.3.3')
    expect(v033?.summary).toMatch(/guest AI|favorites/i)
    expect(v033?.bullets.length).toBeGreaterThanOrEqual(4)
    const v034 = notes.get('v0.3.4') ?? notes.get('0.3.4')
    expect(v034?.screenshots[0]?.src).toBe(
      '/assets/screenshots/tools-advisor-dark.jpeg'
    )
    const html = friendlyNoteToHtml(v033!)
    expect(html).toContain('<p>')
    expect(html).toContain('<li>')
    expect(html).not.toContain('50 commits')
    expect(html).not.toContain('shoutout')
  })
})
