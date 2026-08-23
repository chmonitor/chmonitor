import { collectReleaseScreenshots, extractMarkdownImages } from './images'
import { describe, expect, test } from 'bun:test'

describe('collectReleaseScreenshots', () => {
  test('merges frontmatter shots with markdown images and drops dupes', () => {
    const shots = collectReleaseScreenshots({
      screenshots: [
        { src: '/assets/screenshots/overview-dark.png', alt: 'Overview' },
      ],
      markdown:
        'Hello\n\n![Overview](/assets/screenshots/overview-dark.png)\n![Health](/assets/screenshots/health-summary.png)',
    })
    expect(shots).toEqual([
      { src: '/assets/screenshots/overview-dark.png', alt: 'Overview' },
      { src: '/assets/screenshots/health-summary.png', alt: 'Health' },
    ])
  })

  test('empty note has no shots', () => {
    expect(
      collectReleaseScreenshots({ markdown: '- a bullet', screenshots: [] })
    ).toEqual([])
  })
})

describe('extractMarkdownImages', () => {
  test('reads alt and url', () => {
    expect(extractMarkdownImages('![Nav](/assets/whats-new/nav.png)')).toEqual([
      { alt: 'Nav', url: '/assets/whats-new/nav.png' },
    ])
  })
})
