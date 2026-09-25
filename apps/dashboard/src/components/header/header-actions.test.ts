import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), './header-actions.tsx'),
  'utf8'
)

describe('HeaderActions composition', () => {
  test('keeps controls in the right-side order used by the header contract', () => {
    const markers = [
      '<GlobalTimeRangePicker />',
      '<RefreshCountdown />',
      '<CommandPalette',
      '<IconButton',
      '<InsightsPopover />',
      '<NotificationsPopover />',
    ]
    const positions = markers.map((marker) => src.indexOf(marker))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(src).toContain('justify-end')
    expect(src).toContain('data-testid="dashboard-header-action-controls"')
  })
})
