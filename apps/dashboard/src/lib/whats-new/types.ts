export type ReleaseSource = 'github' | 'snapshot' | 'none'

export interface ReleaseNote {
  version: string
  tag: string
  publishedAt: string | null
  summary: string
  markdown: string
  highlights: string[]
}

export interface ReleasesPayload {
  success: boolean
  source: ReleaseSource
  data: ReleaseNote[]
  error?: string
}
