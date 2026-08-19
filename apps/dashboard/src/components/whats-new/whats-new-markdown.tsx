import type { Components } from 'react-markdown'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-foreground"
    >
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    src ? (
      <img
        src={src}
        alt={alt ?? ''}
        className="my-2 max-h-64 w-full rounded-md border border-border object-contain"
        loading="lazy"
      />
    ) : null,
}

interface WhatsNewMarkdownProps {
  markdown: string
  className?: string
}

export function WhatsNewMarkdown({
  markdown,
  className,
}: WhatsNewMarkdownProps) {
  if (!markdown.trim()) return null

  return (
    <div
      className={cn(
        'text-[13px] leading-normal text-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-[13px] [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
