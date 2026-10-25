import type { DBType, PeerInfoResponse } from '@/lib/peerdb/types'

import { dbTypeLabel, normalizeDbType, peerKind } from './peerdb-utils'
import { DbLogo, hasDbLogo } from '@/components/icons/peerdb-logo'
import { usePeerDB } from '@/lib/swr'
import { cn } from '@/lib/utils'

interface PeerInfoCardProps {
  name?: string
  type?: DBType
  peerRole: 'source' | 'destination'
}

function isSecret(key: string): boolean {
  const k = key.toLowerCase()
  return k.includes('password') || k.includes('secret') || k.includes('token')
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.join('\n')
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (v == null) return '—'
  return String(v)
}

/** Source/destination peer card: GET /v1/peers/info/{peer} → config + version. */
export function PeerInfoCard({ name, type, peerRole }: PeerInfoCardProps) {
  const { data } = usePeerDB<PeerInfoResponse>(
    name ? `/peers/info/${encodeURIComponent(name)}` : null,
    { refreshInterval: 120_000 }
  )

  const resolvedType = normalizeDbType(type ?? data?.peer?.type)
  const k = peerKind(resolvedType)
  const config = data?.peer?.config ?? {}
  const entries = Object.entries(config)
  const region = (config.region as string | undefined) ?? undefined

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-[10px] max-sm:text-xs font-bold"
            style={{ background: k.bg, color: k.fg }}
          >
            {hasDbLogo(resolvedType) ? (
              <DbLogo type={resolvedType} className="size-full p-[3px]" />
            ) : (
              k.mono
            )}
          </span>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-mono text-[12px] font-semibold">
                {name}
              </span>
              <span className="inline-flex items-center rounded-md border border-border bg-muted px-1 font-mono text-[9.5px] max-sm:text-xs text-muted-foreground">
                {peerRole}
              </span>
            </div>
            <div className="text-[10px] max-sm:text-xs uppercase leading-tight tracking-wider text-muted-foreground">
              {dbTypeLabel(type ?? data?.peer?.type)}
              {region ? ` · ${region}` : ''}
            </div>
          </div>
        </div>
      </div>

      {data?.version && (
        <div className="border-b border-border bg-muted/20 px-3 py-1.5">
          <div className="mb-0.5 text-[9.5px] max-sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Server version
          </div>
          <div
            className="line-clamp-2 break-all font-mono text-[10.5px] max-sm:text-xs leading-tight text-foreground/90"
            title={data.version}
          >
            {data.version}
          </div>
        </div>
      )}

      <dl className="flex flex-col">
        {entries.length === 0 ? (
          <div className="p-3 text-[11px] max-sm:text-xs text-muted-foreground">
            {name ? 'No peer config available.' : 'Unknown peer.'}
          </div>
        ) : (
          entries.map(([key, value]) => (
            <div
              key={key}
              className="flex min-w-0 items-baseline gap-3 border-b border-border px-3 py-1.5 last:border-b-0"
            >
              <dt className="w-[100px] shrink-0 text-[10px] max-sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {key}
              </dt>
              <dd
                className={cn(
                  'flex-1 truncate whitespace-pre-wrap font-mono text-[11.5px] max-sm:text-xs tabular-nums',
                  isSecret(key) && 'text-muted-foreground'
                )}
                title={isSecret(key) ? '********' : formatValue(value)}
              >
                {isSecret(key) ? '********' : formatValue(value)}
              </dd>
            </div>
          ))
        )}
      </dl>
    </div>
  )
}
