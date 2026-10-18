'use client'

import type { TextMessagePartComponent } from '@assistant-ui/react'
import type {
  Components,
  ExtraProps,
  MermaidErrorComponentProps,
} from 'streamdown'

import { mermaid as mermaidPlugin } from '@streamdown/mermaid'
import { useTheme } from 'next-themes'
import { type ComponentProps, memo, useMemo } from 'react'
import { Streamdown } from 'streamdown'

import '@/components/agents/markdown-code.css'

import { cn } from '@/lib/utils'

type MarkdownLinkProps = ComponentProps<'a'> & ExtraProps
type MarkdownTableProps = ComponentProps<'table'> & ExtraProps

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

function MarkdownLink({ href, children, className }: MarkdownLinkProps) {
  const isExternal = typeof href === 'string' && href.startsWith('http')
  return (
    <a
      href={href}
      className={className}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  )
}

function MarkdownTable({ children, className }: MarkdownTableProps) {
  return (
    <div className="my-3 overflow-x-auto">
      <table className={cn('w-full text-sm', className)}>{children}</table>
    </div>
  )
}

// Streamdown `Components` intersects per-tag props with a string index of
// `Record<string, unknown> & ExtraProps`. Typed renderers use the per-tag
// ExtraProps shape; the map is asserted so tsc does not reject the object.
const streamdownComponents = {
  a: MarkdownLink,
  table: MarkdownTable,
} as Components

/** `Streamdown` renders partial tokens cleanly while a response streams. */
const MarkdownTextImpl: TextMessagePartComponent = ({ text }) => {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const mermaidTheme = isDark ? 'dark' : 'default'

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
        components={streamdownComponents}
      >
        {text ?? ''}
      </Streamdown>
    </div>
  )
}

MarkdownTextImpl.displayName = 'MarkdownText'

export const MarkdownText = memo(MarkdownTextImpl)
