import type { ReleaseNote } from './types'

export interface AirgapSnapshot {
  notes: ReleaseNote[]
}

export function serializeAirgapSnapshot(notes: ReleaseNote[]): string {
  const payload: AirgapSnapshot = { notes }
  return `${JSON.stringify(payload, null, 2)}\n`
}

export function parseAirgapSnapshot(raw: unknown): ReleaseNote[] {
  if (!raw || typeof raw !== 'object') return []
  const notes = (raw as { notes?: unknown }).notes
  if (!Array.isArray(notes)) return []
  return notes.filter(isReleaseNote)
}

function isReleaseNote(value: unknown): value is ReleaseNote {
  if (!value || typeof value !== 'object') return false
  const note = value as Partial<ReleaseNote>
  return (
    typeof note.version === 'string' &&
    typeof note.tag === 'string' &&
    typeof note.markdown === 'string' &&
    Array.isArray(note.highlights)
  )
}
