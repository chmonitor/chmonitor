import { CheckIcon, CopyIcon } from 'lucide-react'

import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { HLJS_TOKEN_CLASSES } from '@/components/ai-elements/hljs-token-classes'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/lib/utils/clipboard'

// Register only needed languages (keeps bundle small)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('json', json)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('javascript', typescript) // TS grammar covers JS
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('python', python)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('markdown', markdown)

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string
  language: string
  showLineNumbers?: boolean
}

type CodeBlockContextType = {
  code: string
}

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: '',
})

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function highlightInline(code: string, language: string): string {
  try {
    return hljs.highlight(code, {
      language,
      ignoreIllegals: true,
    }).value
  } catch {
    return escapeHtml(code)
  }
}

export function highlightCode(
  code: string,
  language: string,
  showLineNumbers = false
): string {
  let highlighted = highlightInline(code, language)

  if (showLineNumbers) {
    const lines = highlighted.split('\n')
    highlighted = lines
      .map(
        (line, i) =>
          `<span class="inline-block min-w-10 mr-4 text-right select-none text-muted-foreground">${i + 1}</span>${line}`
      )
      .join('\n')
  }

  return `<pre class="m-0 bg-background! p-4 text-foreground! text-sm"><code class="font-mono text-sm hljs">${highlighted}</code></pre>`
}

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const [html, setHtml] = useState<string>('')
  const mounted = useRef(false)

  useEffect(() => {
    const result = highlightCode(code, language, showLineNumbers)
    if (!mounted.current) {
      setHtml(result)
      mounted.current = true
    }

    return () => {
      mounted.current = false
    }
  }, [code, language, showLineNumbers])

  return (
    <CodeBlockContext.Provider value={{ code }}>
      <div
        className={cn(
          'group relative w-full overflow-hidden rounded-md border bg-background text-foreground',
          className
        )}
        {...props}
      >
        <div className="relative">
          <div
            className={cn('overflow-auto', HLJS_TOKEN_CLASSES)}
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {children && (
            <div className="absolute top-2 right-2 flex items-center gap-2">
              {children}
            </div>
          )}
        </div>
      </div>
    </CodeBlockContext.Provider>
  )
}

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
}

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false)
  const { code } = useContext(CodeBlockContext)

  const handleCopyClick = async () => {
    const success = await copyToClipboard(code)
    if (success) {
      setIsCopied(true)
      onCopy?.()
      setTimeout(() => setIsCopied(false), timeout)
    } else {
      onError?.(new Error('Failed to copy code'))
    }
  }

  const Icon = isCopied ? CheckIcon : CopyIcon

  return (
    <Button
      className={cn('shrink-0', className)}
      onClick={handleCopyClick}
      size="icon"
      variant="ghost"
      aria-label={isCopied ? 'Copied' : 'Copy code'}
      {...props}
    >
      {children ?? <Icon size={14} />}
    </Button>
  )
}
