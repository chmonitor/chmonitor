export type ScreenshotAsset = {
  id: string
  src: string
  alt: string
  label?: string
}

export function resolveScreenshotZoom(
  screenshots: ScreenshotAsset[],
  id: string
): { src: string; alt: string } | null {
  const match = screenshots.find((shot) => shot.id === id)
  if (!match) return null
  return { src: match.src, alt: match.alt }
}
