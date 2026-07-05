'use client'

/**
 * AI Insights settings example/preview.
 *
 * Renders a **static, illustrative** set of example insight cards that reflect
 * the operator's current settings (prompt style / enrichment / window). It makes
 * NO network or LLM call, so the example always renders — including for
 * anonymous visitors and read-only demo hosts, which previously only saw
 * "Couldn't generate — the cluster may be unreachable or read-only."
 *
 * This is sample data, not live cluster analysis; the header labels it "Sample".
 * The real generation still runs on the overview panel and via the cron.
 */

import { FlaskConical, RefreshCw } from 'lucide-react'

import { useMemo, useState } from 'react'
import { InsightCard } from '@/components/insights/insight-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildMockInsights } from '@/lib/insights/mock-preview'
import { useInsightsSettings } from '@/lib/query/use-insights-settings'

export function InsightsPreview({
  hostId,
  // `autoRun` is kept for API compatibility with call sites; the example now
  // renders synchronously so there is nothing to defer.
  autoRun: _autoRun = false,
}: {
  hostId: number
  autoRun?: boolean
}) {
  const { settings } = useInsightsSettings()
  const [seed, setSeed] = useState(0)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const insights = useMemo(
    () => buildMockInsights(hostId, settings, seed),
    [hostId, settings, seed]
  )
  const results = insights.filter((i) => !dismissed.has(i.key))

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="size-4 text-muted-foreground" />
          Example
          <Badge variant="secondary" className="font-normal text-[10px]">
            Sample
          </Badge>
        </CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2 text-xs"
          onClick={() => {
            setDismissed(new Set())
            setSeed((s) => s + 1)
          }}
          aria-label="Show another example"
        >
          <RefreshCw className="size-3.5" />
          Regenerate
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {results.length > 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {results.map((insight) => (
              <InsightCard
                key={insight.key}
                insight={insight}
                hostId={hostId}
                onDismiss={(i) =>
                  setDismissed((prev) => new Set(prev).add(i.key))
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            All examples dismissed — Regenerate to show another set.
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Illustrative sample reflecting your settings — not live analysis of
          this cluster. Real insights appear on the overview page.
        </p>
      </CardContent>
    </Card>
  )
}
