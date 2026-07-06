import { resolveScreenshotZoom } from './screenshot-zoom'
import { describe, expect, test } from 'bun:test'

const SHOTS = [
  {
    id: 'overview',
    src: '/landing-assets/overview-insights-dark.webp',
    alt: 'Overview',
  },
  { id: 'agent', src: '/landing-assets/ai-agent-new-dark.webp', alt: 'Agent' },
]

describe('resolveScreenshotZoom', () => {
  test('returns src and alt for a known id', () => {
    expect(resolveScreenshotZoom(SHOTS, 'agent')).toEqual({
      src: '/landing-assets/ai-agent-new-dark.webp',
      alt: 'Agent',
    })
  })

  test('returns null for unknown id', () => {
    expect(resolveScreenshotZoom(SHOTS, 'missing')).toBeNull()
  })
})
