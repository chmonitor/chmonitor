'use client'

/**
 * AI Insights settings example/preview.
 *
 * Runs insight generation with the operator's *current* settings (model / prompt
 * style / enrichment) via an isolated mutation — it never touches the overview
 * panel's TanStack Query cache, so the settings page acts as a sandbox for
 * A/B-ing prompt styles and models before relying on them. With `autoRun` it
 * generates one example on mount so the page shows a live sample immediately.
 */

import { FlaskConical, RefreshCw } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'

import type { InsightCard as InsightCardData } from '@/lib/insights/types'

import { useEffect, useRef, useState } from 'react'
import { InsightCard } from '@/components/insights/insight-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { generateParamsFromSettings } from '@/lib/insights/settings'
import { useInsightsSettings } from '@/lib/query/use-insights-settings'
import { apiFetch } from '@/lib/swr/api-fetch'

interface PreviewResponse {
  insights: InsightCardData[]
  count: number
}

export function InsightsPreview({
  hostId,
  autoRun = false,
}: {
  hostId: number
  autoRun?: boolean
}) {
  const { settings } = useInsightsSettings()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const preview = useMutation({
    mutationFn: async (): Promise<PreviewResponse> => {
      // Explicit "Regenerate example" click → force past the server throttle.
      const params = generateParamsFromSettings(hostId, settings, {
        force: true,
      })
      const res = await apiFetch(`/api/v1/insights/generate?${params}`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to generate preview')
      return res.json()
    },
    onMutate: () => setDismissed(new Set()),
  })

  // Generate one example on mount when asked, so the page is never empty.
  const mutate = preview.mutate
  const didAutoRun = useRef(false)
  useEffect(() => {
    if (autoRun && !didAutoRun.current) {
      didAutoRun.current = true
      mutate()
    }
  }, [autoRun, mutate])

  const results = (preview.data?.insights ?? []).filter(
    (i) => !dismissed.has(i.key)
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="size-4 text-violet-500" />
          Example
        </CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2 text-xs"
          onClick={() => preview.mutate()}
          disabled={preview.isPending}
          aria-label="Regenerate example"
        >
          <RefreshCw
            className={preview.isPending ? 'size-3.5 animate-spin' : 'size-3.5'}
          />
          {preview.isPending ? 'Generating…' : 'Regenerate'}
        </Button>
      </CardHeader>

      <CardContent>
        {preview.isPending && results.length === 0 ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : preview.isError ? (
          <p className="text-sm text-destructive">
            Couldn’t generate — the cluster may be unreachable or read-only.
          </p>
        ) : preview.isSuccess && results.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing notable on this cluster right now.
          </p>
        ) : results.length > 0 ? (
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
            Regenerate to preview insights with your current settings.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
