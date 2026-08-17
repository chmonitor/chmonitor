'use client'

import type { TextMessagePartComponent } from '@assistant-ui/react'
import type { MermaidErrorComponentProps } from 'streamdown'

import { mermaid as mermaidPlugin } from '@streamdown/mermaid'
import { useTheme } from 'next-themes'
import {
  type AnchorHTMLAttributes,
  type ComponentProps,
  memo,
  type TableHTMLAttributes,
  useMemo,
} from 'react'
import { Streamdown } from 'streamdown'

import '@/components/agents/markdown-code.css'

/**
 * Fallback shown when a mermaid diagram fails to parse or render.
 * Displays the raw source in a code block so the user can still read it.
 */
function MermaidError({ chart, error }: MermaidErrorComponentProps) {
  return (
    <div className="my-3 rounded-md border border-border/60 px-3 py-2 text-sm">
      <p className="mb-1.5 text-xs text-muted-foreground">
        Diagram could not be rendered
        {error ? ` — ${error}` : ''}
      </p>
      <pre className="overflow-x-auto font-mono text-xs text-muted-foreground">
        {chart}
      </pre>
    </div>
  )
}

function MarkdownLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const isExternal = href?.startsWith('http')
  return (
    <a
      href={href}
      {...props}
      {...(isExternal
        ? { target: '_blank', rel: 'noopener noreferrer' }
        : {})}
    >
      {children}
    </a>
  )
}

function MarkdownTable({
  children,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="my-3 overflow-x-auto">
      <table {...props} className="w-full text-sm">
        {children}
      </table>
    </div>
  )
}

/**
 * Markdown renderer for assistant-ui text message parts.
 *
 * Uses `Streamdown` (streaming-aware markdown) so partial tokens render
 * cleanly while a response is in flight, and keeps mermaid diagram support
 * plus the project's existing `.markdown-content` styling from globals.css.
 *
 * Syntax highlighting is provided by Streamdown's built-in Shiki integration
 * via the `shikiTheme` prop. The theme tuple is wired to next-themes so code
 * blocks switch between github-light (light mode) and github-dark (dark mode)
 * automatically. This replaces the previous manual .hljs-* CSS overrides which
 * are now removed from markdown-code.css.
 *
 * Mermaid theme adapts to the app's dark/light mode via next-themes.
 */
const MarkdownTextImpl: TextMessagePartComponent = ({ text }) => {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const mermaidTheme = isDark ? 'dark' : 'default'

  // Shiki theme tuple: [light-theme, dark-theme].
  // Streamdown reads the active theme from the CSS `color-scheme` on the
  // root element (set by next-themes). Passing both themes lets Shiki embed
  // dual-theme CSS vars; Streamdown then switches via the dark-class variant
  // already declared in globals.css (@custom-variant dark (&:is(.dark *))).
  const shikiTheme = useMemo<
    NonNullable<ComponentProps<typeof Streamdown>['shikiTheme']>
  >(() => ['github-light', 'github-dark'], [])

  return (
    <div className="markdown-content aui-md text-sm leading-6">
      <Streamdown
        shikiTheme={shikiTheme}
        mermaid={{
          config: { theme: mermaidTheme },
          errorComponent: MermaidError,
        }}
        plugins={{ mermaid: mermaidPlugin }}
        components={{
          a: MarkdownLink,
          table: MarkdownTable,
        }}
      >
        {text ?? ''}
      </Streamdown>
    </div>
  )
}

MarkdownTextImpl.displayName = 'MarkdownText'

export const MarkdownText = memo(MarkdownTextImpl)
