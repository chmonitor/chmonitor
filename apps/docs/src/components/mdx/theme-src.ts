/**
 * Light/dark image selection shared by Screenshot, ImageRow and the zoom
 * dialog. Mirrors the blog's `data-src-light` / `data-src-dark` swap: the
 * dark source is used only when the page is dark AND a dark variant exists.
 */
export function pickThemeSrc(
  isDark: boolean,
  src: string,
  srcDark?: string
): string {
  return isDark && srcDark ? srcDark : src
}

/** Fumadocs (next-themes) marks dark mode with `class="dark"` on <html>. */
export function isDarkDocument(doc: Document | undefined): boolean {
  return doc?.documentElement.classList.contains('dark') ?? false
}
