import { useTheme } from 'next-themes'
import { useEffect, useRef, useState } from 'react'

interface MermaidProps {
  chart: string
}

/**
 * Client-side Mermaid diagram renderer.
 *
 * `remarkMdxMermaid` (from fumadocs-core/mdx-plugins) converts ```mermaid
 * fenced blocks into <Mermaid chart="..." /> JSX at build time.  This
 * component initialises the mermaid runtime in the browser and renders the
 * SVG result.  Diagrams are client-hydrated: SSR/prerender emits a loading
 * placeholder, then the SVG appears after hydration.
 */
export function Mermaid({ chart }: MermaidProps) {
  const { resolvedTheme } = useTheme()
  const id = useRef(`mermaid-${Math.random().toString(36).slice(2)}`)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function render() {
      // Dynamic import keeps mermaid (heavy, browser-only) out of the SSR bundle.
      const { default: mermaid } = await import('mermaid')

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: resolvedTheme === 'dark' ? 'dark' : 'default',
      })

      try {
        const { svg: rendered } = await mermaid.render(id.current, chart)
        if (!cancelled) setSvg(rendered)
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err))
      }
    }

    render()
    return () => {
      cancelled = true
    }
  }, [chart, resolvedTheme])

  if (error) {
    return (
      <pre className="text-destructive bg-destructive/10 rounded p-3 text-sm overflow-auto">
        Mermaid error: {error}
      </pre>
    )
  }

  if (!svg) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        className="my-4 flex min-h-48 items-center justify-center rounded-md border border-fd-border bg-fd-muted/40 text-sm text-fd-muted-foreground"
      >
        Loading diagram…
      </div>
    )
  }

  return (
    <div
      dangerouslySetInnerHTML={{ __html: svg }}
      className="my-4 flex justify-center overflow-auto [&_svg]:max-w-full"
    />
  )
}
