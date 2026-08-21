import { ExternalLink } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'

import type { ReleaseNote } from '@/lib/whats-new/types'

import { WhatsNewMarkdown } from './whats-new-markdown'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  GITHUB_RELEASES_PAGE_URL,
  LANDING_CHANGELOG_URL,
} from '@/lib/whats-new/constants'
import { toProductTag } from '@/lib/whats-new/version'

function formatPublishedDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function VersionHeading({ note }: { note: ReleaseNote }) {
  const label =
    note.version === 'unreleased' ? 'Unreleased' : toProductTag(note.version)
  const date = formatPublishedDate(note.publishedAt)
  return (
    <h3 className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      {date ? (
        <span className="text-xs font-normal text-muted-foreground">
          {date}
        </span>
      ) : null}
    </h3>
  )
}

interface WhatsNewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGotIt: () => void
  releases: ReleaseNote[]
  isLoading: boolean
  error?: string
  onRetry?: () => void
}

export function WhatsNewDialog({
  open,
  onOpenChange,
  onGotIt,
  releases,
  isLoading,
  error,
  onRetry,
}: WhatsNewDialogProps) {
  // Default dialog focus picks the first tabbable in the popup. Older release
  // notes can contain many markdown links deep in the scroll body, so that
  // scrollIntoView lands mid-list. Pin initial focus to the title (outside the
  // scroll container) and reset scroll whenever content settles.
  const titleRef = useRef<HTMLHeadingElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    bodyRef.current?.scrollTo(0, 0)
  }, [open, isLoading, releases])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(36rem,85vh)] flex-col gap-0 overflow-hidden rounded-xl border bg-card p-0 sm:max-w-lg"
        data-testid="whats-new-dialog"
        initialFocus={titleRef}
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3">
          <DialogTitle ref={titleRef} tabIndex={-1}>
            What's new
          </DialogTitle>
          <DialogDescription>
            Product changes since your last visit.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-y-auto"
          data-testid="whats-new-dialog-body"
        >
          <div className="flex flex-col gap-6 px-4 py-4">
            {isLoading ? (
              <div
                className="flex flex-col gap-3"
                data-testid="whats-new-loading"
              >
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : null}

            {!isLoading && error && releases.length === 0 ? (
              <EmptyState
                compact
                variant="error"
                title="Couldn't load release notes"
                description={error}
                onRefresh={onRetry}
              />
            ) : null}

            {!isLoading && !error && releases.length === 0 ? (
              <EmptyState
                compact
                variant="no-data"
                title="No release notes yet"
                description="Check GitHub Releases for the full history."
              />
            ) : null}

            {releases.map((note) => (
              <section
                key={note.tag}
                className="flex flex-col gap-2"
                data-testid="whats-new-version"
              >
                <VersionHeading note={note} />
                <WhatsNewMarkdown markdown={note.markdown} />
              </section>
            ))}
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 items-center gap-2 sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              variant="link"
              className="h-auto p-0 text-xs"
              render={
                <a
                  href={GITHUB_RELEASES_PAGE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub Releases
                  <ExternalLink className="ml-1 size-3" />
                </a>
              }
            />
            <Button
              variant="link"
              className="h-auto p-0 text-xs"
              render={
                <a
                  href={LANDING_CHANGELOG_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Changelog
                  <ExternalLink className="ml-1 size-3" />
                </a>
              }
            />
          </div>
          <Button data-testid="whats-new-got-it" onClick={onGotIt}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
