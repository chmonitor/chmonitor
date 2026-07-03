// Build-time GitHub repo stats, fetched ONCE and shared across landing
// components (the hero star badge + the SocialProof community card) so the
// static build makes a single API call instead of one per component.
//
// Fails open: on any error (offline build, rate limit, non-200) the counts are
// `null` and callers render the CTA WITHOUT a fabricated number — never a
// placeholder or invented count. See plans/68-github-star-social-proof.md.

export const GITHUB_REPO = 'chmonitor/chmonitor'

export interface GitHubStats {
  stars: number | null
  forks: number | null
  /** Human month/year of the last push, e.g. "Jul 2026", or null on failure. */
  updated: string | null
}

const EMPTY: GitHubStats = { stars: null, forks: null, updated: null }

/**
 * Fetch repo stats from the GitHub REST API. Pure (no module cache) so it is
 * unit-testable; {@link getGitHubStats} adds the build-time memoization.
 */
export async function fetchGitHubStats(repo: string): Promise<GitHubStats> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'chmonitor-landing',
      },
    })
    if (!res.ok) return { ...EMPTY }

    const d = (await res.json()) as {
      stargazers_count?: unknown
      forks_count?: unknown
      pushed_at?: unknown
    }
    return {
      stars: typeof d.stargazers_count === 'number' ? d.stargazers_count : null,
      forks: typeof d.forks_count === 'number' ? d.forks_count : null,
      updated:
        typeof d.pushed_at === 'string'
          ? new Date(d.pushed_at).toLocaleDateString('en-US', {
              month: 'short',
              year: 'numeric',
            })
          : null,
    }
  } catch {
    // Offline / rate-limited build — render without counts, never fabricate one.
    return { ...EMPTY }
  }
}

let cached: Promise<GitHubStats> | null = null

/** Repo stats for the current build, fetched at most once and shared. */
export function getGitHubStats(): Promise<GitHubStats> {
  if (!cached) cached = fetchGitHubStats(GITHUB_REPO)
  return cached
}

/** Compact count for display (e.g. `1.2k`); empty string when unknown. */
export function formatCount(n: number | null): string {
  if (n == null) return ''
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
