import { CheckCircle2Icon } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'

interface MatchOkProps {
  title: string
  description: string
}

export function MatchOk({ title, description }: MatchOkProps) {
  return (
    <Card
      className="rounded-xl border bg-card py-0 shadow-sm"
      data-testid="schema-diff-match-ok"
    >
      <CardContent className="flex items-start gap-3 p-4">
        <CheckCircle2Icon
          className="mt-0.5 size-5 shrink-0 text-[var(--chart-green)]"
          strokeWidth={1.5}
          aria-hidden
        />
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}
