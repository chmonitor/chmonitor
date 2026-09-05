/** Joins the text parts of a message's `content`/parts array into one string. */
export function messagePartsText(parts: readonly unknown[]): string {
  return (parts as { type?: string; text?: string }[])
    .filter((part) => part?.type === 'text')
    .map((part) => part.text ?? '')
    .join(' ')
}
