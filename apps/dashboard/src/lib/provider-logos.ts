/**
 * Provider logo system.
 *
 * Two resolution strategies:
 * 1. svgl.app CDN URL → used by ModelSelectorLogo (<img> src)
 * 2. Inline monogram fallback → used when a provider isn't on svgl.app
 *
 * The svgl.app CDN is the primary source for real brand logos.
 * Providers not on svgl.app get a deterministic letter monogram.
 */

const SVGL_BASE = 'https://svgl.app/library'

/**
 * Maps normalised provider names to svgl.app CDN URLs.
 *
 * Key = lowercased, with `-`, `_`, and whitespace removed.
 * Source: https://svgl.app  /  https://github.com/pheralb/svgl
 */
const SVGL_URLS: Record<string, string> = {
  // Single-variant SVGs
  openai: `${SVGL_BASE}/openai.svg`,
  google: `${SVGL_BASE}/google.svg`,
  deepseek: `${SVGL_BASE}/deepseek.svg`,
  groq: `${SVGL_BASE}/groq.svg`,
  huggingface: `${SVGL_BASE}/hugging_face.svg`,
  cloudflare: `${SVGL_BASE}/cloudflare.svg`,
  cloudflareworkersai: `${SVGL_BASE}/cloudflare.svg`,
  meta: `${SVGL_BASE}/meta.svg`,
  llama: `${SVGL_BASE}/meta.svg`,
  azure: `${SVGL_BASE}/azure.svg`,
  microsoftazure: `${SVGL_BASE}/azure.svg`,
  cerebras: `${SVGL_BASE}/cerebras-dark.svg`,
  stabilityai: `${SVGL_BASE}/stability-ai.svg`,

  // Dark-aware SVGs (light variant; callers add `dark:invert`)
  openrouter: `${SVGL_BASE}/openrouter_light.svg`,
  anthropic: `${SVGL_BASE}/anthropic_black.svg`,
  nvidia: `${SVGL_BASE}/nvidia-icon-light.svg`,
  togetherai: `${SVGL_BASE}/togetherai_light.svg`,
  vercel: `${SVGL_BASE}/vercel.svg`,
  xai: `${SVGL_BASE}/xai_light.svg`,
  replicate: `${SVGL_BASE}/replicate_light.svg`,
  copilot: `${SVGL_BASE}/copilot.svg`,
  githubcopilot: `${SVGL_BASE}/copilot.svg`,
  githubmodels: `${SVGL_BASE}/copilot.svg`,
  v0: `${SVGL_BASE}/v0_light.svg`,
  amazonbedrock: `${SVGL_BASE}/amazon-q.svg`,
}

/** Return the svgl.app CDN URL for a provider, or null if unknown. */
export function svglLogoUrl(provider: string): string | null {
  const key = provider.toLowerCase().replace(/[-_\s]/g, '')
  return SVGL_URLS[key] ?? null
}

/** True when a real svgl.app logo exists for this provider. */
export function hasSvgLogo(provider: string): boolean {
  return svglLogoUrl(provider) !== null
}

const MONOGRAM_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#f97316',
  '#ef4444',
  '#6366f1',
  '#84cc16',
]

export function monogramColor(provider: string): string {
  let hash = 0
  for (let i = 0; i < provider.length; i++) {
    hash = provider.charCodeAt(i) + ((hash << 5) - hash)
  }
  return MONOGRAM_COLORS[Math.abs(hash) % MONOGRAM_COLORS.length]
}

export function monogramLetter(provider: string): string {
  return provider.charAt(0).toUpperCase()
}
