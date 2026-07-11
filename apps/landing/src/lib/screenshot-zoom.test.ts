import { resolveScreenshotZoom } from './screenshot-zoom'
import { describe, expect, test } from 'bun:test'

const SHOTS = [
  {
    id: 'overview',
    src: '/assets/screenshots/overview-insights-dark.webp',
    alt: 'Overview',
  },
  {
    id: 'agent',
    src: '/assets/screenshots/ai-agent-new-dark.webp',
    alt: 'Agent',
  },
]

describe('resolveScreenshotZoom', () => {
  test('returns src and alt for a known id', () => {
    expect(resolveScreenshotZoom(SHOTS, 'agent')).toEqual({
      src: '/assets/screenshots/ai-agent-new-dark.webp',
      alt: 'Agent',
    })
  })

  test('returns null for unknown id', () => {
    expect(resolveScreenshotZoom(SHOTS, 'missing')).toBeNull()
  })
})
