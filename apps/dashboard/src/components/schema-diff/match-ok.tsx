import { CheckCircle2Icon } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'

interface MatchOkProps {
  title: string
  description: string
  compact?: boolean
}

export function MatchOk({ title, description, compact = false }: MatchOkProps) {
  const icon = (
    <CheckCircle2Icon
      className={
        compact
          ? 'size-3.5 shrink-0 text-[var(--chart-green)]'
          : 'mt-0.5 size-5 shrink-0 text-[var(--chart-green)]'
      }
      strokeWidth={1.5}
      aria-hidden
    />
  )
  const copy = (
    <>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p
        className={
          compact
            ? 'text-[11px] text-muted-foreground'
            : 'mt-0.5 text-xs text-muted-foreground'
        }
      >
        {description}
      </p>
    </>
  )

  if (compact) {
    return (
      <div
        className="flex min-w-0 items-center gap-2"
        data-testid="schema-diff-match-ok"
      >
        {icon}
        <div className="min-w-0 leading-tight">{copy}</div>
      </div>
    )
  }

  return (
    <Card
      className="rounded-xl border bg-card py-0 shadow-sm"
      data-testid="schema-diff-match-ok"
    >
      <CardContent className="flex items-start gap-3 p-4">
        {icon}
        <div>{copy}</div>
      </CardContent>
    </Card>
  )
}
