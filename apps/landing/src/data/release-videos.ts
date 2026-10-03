/**
 * Launch videos shown inline on /changelog, keyed by release tag.
 * Add an entry here when a release ships with a YouTube video.
 */
export type ReleaseVideo = {
  youtubeId: string
  title: string
}

const RELEASE_VIDEOS: Record<string, ReleaseVideo> = {
  'v0.3.6': {
    youtubeId: 'n8p4JwNHcGQ',
    title: 'chmonitor v0.3.6 launch video',
  },
}

export function releaseVideo(tag: string): ReleaseVideo | undefined {
  return RELEASE_VIDEOS[tag] ?? RELEASE_VIDEOS[`v${tag.replace(/^v/i, '')}`]
}
