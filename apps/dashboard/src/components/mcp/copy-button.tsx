import { Check, Copy } from 'lucide-react'

import { type MouseEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/lib/utils/clipboard'

interface CopyButtonProps {
  text: string
  className?: string
  label?: string
}

export function CopyButton({ text, className, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: MouseEvent) => {
    // Never let a copy click bubble to a clickable ancestor (breadcrumb link,
    // tree row, table cell): copying should not also navigate or select.
    e.stopPropagation()
    const success = await copyToClipboard(text)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (label) {
    return (
      <Button
        variant="outline"
        size="sm"
        // Labelled control: grow the HEIGHT only and let the width follow the
        // label. A `pointer-coarse:size-9` here would pin the pill narrower than
        // its own content, pushing the icon and the text outside the rounded
        // background and leaving a smaller tappable area than the mouse one.
        className={cn('gap-1.5 pointer-coarse:h-9', className)}
        onClick={handleCopy}
      >
        {copied ? (
          <span className="t-success-check">
            <Check className="size-3.5 text-green-600" />
          </span>
        ) : (
          <Copy className="size-3.5" />
        )}
        {copied ? 'Copied!' : label}
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      // Icon-only, so both axes grow: `size-9` (36px) for a finger. It is
      // emitted after the plain `h-7 w-7` below and shares its specificity, so
      // it wins both width and height inside `@media (pointer: coarse)`.
      className={cn('h-7 w-7 p-0 pointer-coarse:size-9', className)}
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy'}
    >
      {copied ? (
        <Check className="size-3.5 text-green-600" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </Button>
  )
}

interface CodeBlockProps {
  children: string
  copyText?: string
  language?: string
  className?: string
}

export function CodeBlock({ children, copyText, className }: CodeBlockProps) {
  return (
    <div className={cn('relative', className)}>
      <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto leading-relaxed">
        <code>{children}</code>
      </pre>
      {/* Always visible, never gated. This is the only way to copy the snippet
          — no context menu, no selection handler — so `group-hover:opacity-100`
          deleted the feature on touch: Tailwind v4 wraps a bare `hover:` in
          `@media (hover: hover)`, so the old resting `opacity-0` left the button
          present, focusable and invisible on every coarse pointer. A copy
          affordance on a code block is ordinary chrome, not something to
          declutter, so the gate is gone rather than re-armed under
          `pointer-fine:`. The wrapper is `absolute`, so nothing else needs to
          move for the button's coarse-pointer `size-9`. */}
      <div className="absolute right-1 top-1">
        <CopyButton text={copyText ?? children} />
      </div>
    </div>
  )
}
