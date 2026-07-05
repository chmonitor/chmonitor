/**
 * Error alert accordion components
 *
 * Reusable accordion components for displaying expandable error details.
 */

import { BugIcon, DatabaseIcon, NotebookPenIcon } from 'lucide-react'

import type React from 'react'

import dedent from 'dedent'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

interface ErrorAlertAccordionProps {
  title: string
  content: string | React.ReactNode
}

/**
 * Renders an expandable accordion for error details (stack trace, query, etc.)
 */
export function ErrorAlertAccordion({
  title,
  content,
}: ErrorAlertAccordionProps) {
  return (
    <div className="mt-3">
      <Accordion className="w-full">
        <AccordionItem className="border-0" value="item-1">
          <AccordionTrigger className="px-0 py-2 text-sm hover:no-underline">
            <div className="flex items-center gap-2">
              <DatabaseIcon className="size-4" />
              {title}
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-0 pb-0">
            <div className="bg-muted/30 rounded p-2">
              <code className="text-muted-foreground text-xs">
                {typeof content === 'string' ? (
                  <pre className="whitespace-pre-wrap">{dedent(content)}</pre>
                ) : (
                  content
                )}
              </code>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

interface ErrorAlertDocsProps {
  docs: string | React.ReactNode
}

/**
 * Renders documentation section with notebook icon
 */
export function ErrorAlertDocs({ docs }: ErrorAlertDocsProps) {
  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-start gap-2">
        <NotebookPenIcon className="text-muted-foreground mt-0.5 size-4 flex-none" />
        <div className="text-muted-foreground text-sm">{docs}</div>
      </div>
    </div>
  )
}

interface ErrorAlertDigestProps {
  digest: string
}

/**
 * Renders error digest (error ID) for support tracking
 */
export function ErrorAlertDigest({ digest }: ErrorAlertDigestProps) {
  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-start gap-2">
        <BugIcon className="text-muted-foreground mt-0.5 size-4 flex-none" />
        <div className="text-muted-foreground text-xs">
          <div className="font-medium">Error ID (for support):</div>
          <code className="bg-muted/30 mt-1 block rounded px-2 py-1 font-mono">
            {digest}
          </code>
        </div>
      </div>
    </div>
  )
}
