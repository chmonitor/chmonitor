import { Check, Copy } from 'lucide-react'

import { type MouseEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (label) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={cn('gap-1.5', className)}
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
      className={cn('h-7 px-2', className)}
      onClick={handleCopy}
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
    <div className={cn('relative group', className)}>
      <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto leading-relaxed">
        <code>{children}</code>
      </pre>
      <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={copyText ?? children} />
      </div>
    </div>
  )
}
