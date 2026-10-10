import { closeZoom, openZoom, type ZoomDialog } from './zoom-controller'
import { describe, expect, test } from 'bun:test'

function fakeDialog(): ZoomDialog & { shows: number } {
  const d = {
    open: false,
    shows: 0,
    showModal() {
      d.open = true
      d.shows++
    },
    close() {
      d.open = false
    },
  }
  return d
}

describe('zoom controller', () => {
  test('a second open (invoker command then onClick) does not re-open', () => {
    const d = fakeDialog()
    openZoom(d)
    openZoom(d)
    expect(d.open).toBe(true)
    expect(d.shows).toBe(1)
  })

  test('null dialog is a no-op and close works', () => {
    openZoom(null)
    const d = fakeDialog()
    openZoom(d)
    closeZoom(d)
    expect(d.open).toBe(false)
  })
})
