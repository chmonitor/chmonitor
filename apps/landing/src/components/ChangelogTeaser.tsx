import { ArrowRight } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import '@/styles/globals.css'

type Props = {
  totalCount: number
  scopeCount: number
}

export default function ChangelogTeaser({ totalCount, scopeCount }: Props) {
  return (
    <section
      className="border-border/60 border-t py-16 sm:py-20"
      data-feature-count={totalCount}
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col items-start justify-between gap-6 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:p-8">
          <div className="max-w-xl">
            <p className="font-medium text-primary text-sm">Ship log</p>
            <h2 className="mt-2 font-semibold text-2xl tracking-tight sm:text-3xl">
              {totalCount} features shipped
            </h2>
            <p className="mt-2 text-pretty text-muted-foreground text-sm sm:text-base">
              Every ✨ Features bullet from CHANGELOG.md — {scopeCount} scopes,
              searchable on the changelog page. Nothing hidden behind marketing
              copy.
            </p>
          </div>
          <a
            href="/changelog#ship-log"
            className={buttonVariants({ size: 'lg' })}
          >
            Browse full ship log
            <ArrowRight className="size-4" />
          </a>
        </div>
      </div>
    </section>
  )
}
