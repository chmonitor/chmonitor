import { Search } from 'lucide-react'

import type { ChangelogFeatureGroup } from '@/lib/parse-changelog-features'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import '@/styles/globals.css'

type Props = {
  groups: ChangelogFeatureGroup[]
  totalCount: number
}

export default function FeaturesCatalog({ groups, totalCount }: Props) {
  const [query, setQuery] = useState('')
  const [activeScope, setActiveScope] = useState<string | null>(null)

  const scopes = useMemo(() => groups.map((g) => g.scope), [groups])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return groups
      .filter((g) => !activeScope || g.scope === activeScope)
      .map((g) => ({
        ...g,
        features: g.features.filter((f) => {
          if (!q) return true
          return (
            f.title.toLowerCase().includes(q) ||
            f.scope.toLowerCase().includes(q) ||
            (f.version?.toLowerCase().includes(q) ?? false)
          )
        }),
      }))
      .filter((g) => g.features.length > 0)
  }, [groups, query, activeScope])

  const visibleCount = filtered.reduce((n, g) => n + g.features.length, 0)

  return (
    <section
      id="ship-log"
      className="py-12 sm:py-16"
      data-feature-count={totalCount}
      data-features-catalog
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-2xl">
          <p className="font-medium text-primary text-sm">Feature index</p>
          <h2 className="mt-2 text-balance font-semibold text-3xl tracking-tight sm:text-4xl">
            Every CHANGELOG feature
          </h2>
          <p className="mt-3 text-pretty text-muted-foreground text-sm sm:text-base">
            Parsed from CHANGELOG.md — grouped by scope, searchable.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter features…"
              className="pl-9"
              aria-label="Filter changelog features"
            />
          </div>
          <p className="text-muted-foreground text-sm tabular-nums">
            Showing {visibleCount} of {totalCount}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveScope(null)}
            className="rounded-full"
          >
            <Badge variant={activeScope === null ? 'default' : 'outline'}>
              All scopes
            </Badge>
          </button>
          {scopes.map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() =>
                setActiveScope(activeScope === scope ? null : scope)
              }
              className="rounded-full"
            >
              <Badge variant={activeScope === scope ? 'default' : 'outline'}>
                {scope}
              </Badge>
            </button>
          ))}
        </div>

        <ScrollArea className="mt-8 max-h-[70vh] pr-2">
          <div className="grid gap-4 sm:grid-cols-2">
            {filtered.map((group) => (
              <Card key={group.scope}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>{group.scope}</span>
                    <Badge variant="secondary">{group.features.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-0 pb-4">
                  {group.features.map((feature, i) => (
                    <div key={`${feature.title}-${feature.version ?? i}`}>
                      {i > 0 ? <Separator className="my-2" /> : null}
                      <p className="text-foreground text-sm leading-snug">
                        {feature.title}
                      </p>
                      {feature.version ? (
                        <p className="mt-0.5 text-muted-foreground text-xs">
                          v{feature.version}
                          {feature.issue ? ` · #${feature.issue}` : ''}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </div>
    </section>
  )
}
