export type ReleaseSource = 'github' | 'snapshot' | 'none'

/** How this version's copy was produced. */
export type ReleaseNoteKind = 'friendly' | 'stripped'

export interface ReleaseNoteScreenshot {
  src: string
  alt: string
}

export interface ReleaseNote {
  version: string
  tag: string
  publishedAt: string | null
  summary: string
  markdown: string
  highlights: string[]
  kind?: ReleaseNoteKind
  screenshots?: ReleaseNoteScreenshot[]
}

export interface FriendlyNote {
  version: string
  date: string | null
  summary: string
  bullets: string[]
  screenshots: ReleaseNoteScreenshot[]
}

export interface ReleasesPayload {
  success: boolean
  source: ReleaseSource
  data: ReleaseNote[]
  error?: string
}
