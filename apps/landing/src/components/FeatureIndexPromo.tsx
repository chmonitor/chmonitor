import { ArrowRight, List } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type Props = {
  totalCount: number
  scopeCount: number
}

export function FeatureIndexPromo({ totalCount, scopeCount }: Props) {
  return (
    <section
      id="feature-index"
      className="border-border/60 border-t py-16 sm:py-20"
      data-feature-index-promo
      data-feature-count={totalCount}
    >
      <div className="mx-auto max-w-6xl px-6">
        <Card className="border-border/70 bg-muted/30">
          <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="flex gap-4">
              <List
                className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                strokeWidth={1.5}
                aria-hidden
              />
              <div>
                <p className="font-medium text-primary text-sm">
                  Complete feature list
                </p>
                <h2 className="mt-1 text-balance font-semibold text-xl tracking-tight sm:text-2xl">
                  Every CHANGELOG feature, searchable
                </h2>
                <p className="mt-2 max-w-xl text-pretty text-muted-foreground text-sm leading-relaxed">
                  <span className="tabular-nums font-medium text-foreground">
                    {totalCount}
                  </span>{' '}
                  monitoring, agent, and alerting features across{' '}
                  <span className="tabular-nums font-medium text-foreground">
                    {scopeCount}
                  </span>{' '}
                  areas — searchable by scope or keyword.
                </p>
              </div>
            </div>
            <a
              href="/changelog#ship-log"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
              data-cta="feature-index"
            >
              Browse feature index
              <ArrowRight className="size-4" />
            </a>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}