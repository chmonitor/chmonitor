/**
 * Open/close logic for the screenshot zoom dialog, kept free of React so it
 * can be tested without a DOM. The native <dialog> gives focus trapping,
 * modal semantics, and Esc-to-close.
 */
export interface ZoomDialog {
  open: boolean
  showModal(): void
  close(): void
}

export function openZoom(dialog: ZoomDialog | null): void {
  if (dialog && !dialog.open) dialog.showModal()
}

export function closeZoom(dialog: ZoomDialog | null): void {
  if (dialog?.open) dialog.close()
}

/** Clicking the backdrop (the dialog element itself, not its content) closes. */
export function shouldCloseOnClick(
  target: EventTarget | null,
  dialog: EventTarget | null
): boolean {
  return target !== null && target === dialog
}

/** Fallback for engines whose <dialog> does not close on Esc by itself. */
export function shouldCloseOnKey(key: string): boolean {
  return key === 'Escape'
}
