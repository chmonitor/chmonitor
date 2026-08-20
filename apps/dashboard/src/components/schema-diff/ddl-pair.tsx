import { CheckIcon, CopyIcon, SparklesIcon } from 'lucide-react'

import type { TableDiff } from '@/lib/schema-diff'
import type { DdlDiffOp, DdlDiffRow } from '@/lib/schema-diff/ddl-diff'

import { MatchOk } from './match-ok'
import { useMemo, useState } from 'react'
import { highlightInline } from '@/components/ai-elements/code-block'
import { HLJS_TOKEN_CLASSES } from '@/components/ai-elements/hljs-token-classes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { alignDdlLines } from '@/lib/schema-diff/ddl-diff'
import { prettySchemaSql } from '@/lib/schema-diff/pretty-sql'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/lib/utils/clipboard'

interface DdlPairProps {
  selected: TableDiff
  sourceLabel?: string
  targetLabel?: string
  allMatched?: boolean
}

function kindBadge(kind: TableDiff['kind']): string {
  switch (kind) {
    case 'only_source':
      return 'source only'
    case 'only_target':
      return 'target only'
    case 'changed':
      return 'changed'
    case 'identical':
      return 'same'
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

export function DdlPair({
  selected,
  sourceLabel,
  targetLabel,
  allMatched = false,
}: DdlPairProps) {
  const [pretty, setPretty] = useState(true)
  const [copied, setCopied] = useState<'source' | 'target' | null>(null)

  const sourceRaw = selected.source?.createTableQuery ?? ''
  const targetRaw = selected.target?.createTableQuery ?? ''
  const sourceSql = pretty && sourceRaw ? prettySchemaSql(sourceRaw) : sourceRaw
  const targetSql = pretty && targetRaw ? prettySchemaSql(targetRaw) : targetRaw

  const rows = useMemo(
    () => alignDdlLines(sourceSql, targetSql),
    [sourceSql, targetSql]
  )

  const copySide = async (side: 'source' | 'target') => {
    const text = side === 'source' ? sourceSql : targetSql
    if (!text) return
    const ok = await copyToClipboard(text)
    if (!ok) return
    setCopied(side)
    window.setTimeout(() => setCopied(null), 1500)
  }

  const matches = selected.kind === 'identical'

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-sm"
      data-testid="schema-diff-ddl-pair"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        {matches ? (
          <MatchOk
            compact
            title={allMatched ? 'All matched' : 'This table matches'}
            description={
              allMatched
                ? 'Every table schema is identical on source and target.'
                : 'Source and target DDL are identical. No recommended statements.'
            }
          />
        ) : (
          <Badge
            variant="outline"
            className="font-normal text-muted-foreground"
          >
            {kindBadge(selected.kind)}
          </Badge>
        )}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <SparklesIcon className="size-3" strokeWidth={1.5} aria-hidden />
          Pretty
          <Switch
            size="sm"
            checked={pretty}
            onCheckedChange={setPretty}
            aria-label="Pretty format SQL"
            data-testid="schema-diff-pretty"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[40rem] md:min-w-0">
          <div className="grid grid-cols-2 border-b border-border">
            <PaneHeader
              kicker="Source DDL"
              name={sourceLabel}
              copied={copied === 'source'}
              disabled={!sourceSql}
              onCopy={() => void copySide('source')}
              className="border-r border-border"
            />
            <PaneHeader
              kicker="Target DDL"
              name={targetLabel}
              copied={copied === 'target'}
              disabled={!targetSql}
              onCopy={() => void copySide('target')}
            />
          </div>
          <div className={cn('grid grid-cols-2', HLJS_TOKEN_CLASSES)}>
            {rows.map((row, index) => (
              <DiffRowView key={index} row={row} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function PaneHeader({
  kicker,
  name,
  copied,
  disabled,
  onCopy,
  className,
}: {
  kicker: string
  name?: string
  copied: boolean
  disabled: boolean
  onCopy: () => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-2 px-3 py-1.5', className)}>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-[11px] font-medium text-muted-foreground">
          {kicker}
        </p>
        {name ? (
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        onClick={onCopy}
        aria-label={copied ? 'Copied' : `Copy ${kicker}`}
        className="size-7 text-muted-foreground hover:text-foreground"
      >
        {copied ? (
          <CheckIcon className="size-3.5" strokeWidth={1.5} />
        ) : (
          <CopyIcon className="size-3.5" strokeWidth={1.5} />
        )}
      </Button>
    </div>
  )
}

function DiffRowView({ row }: { row: DdlDiffRow }) {
  return (
    <>
      <DiffCell side="left" row={row} />
      <DiffCell side="right" row={row} />
    </>
  )
}

function DiffCell({ side, row }: { side: 'left' | 'right'; row: DdlDiffRow }) {
  const cell = side === 'left' ? row.left : row.right
  const empty = !cell
  return (
    <div
      className={cn(
        'flex min-w-0 items-start gap-2 px-2 py-0.5 font-mono text-[12px] leading-5',
        side === 'left' && 'border-r border-border',
        lineTone(side, row.op)
      )}
      data-diff={row.op}
      data-side={side}
      data-testid={`schema-diff-ddl-${side}`}
    >
      <span
        className="w-7 shrink-0 select-none pt-px text-right text-[10px] tabular-nums text-muted-foreground"
        data-testid="schema-diff-line-gutter"
      >
        {cell?.no ?? ''}
      </span>
      {empty ? (
        <span className="min-w-0 flex-1 text-muted-foreground">
          {side === 'left' ? 'Not on source' : 'Not on target'}
        </span>
      ) : (
        <code
          className="hljs min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground"
          dangerouslySetInnerHTML={{
            __html: highlightInline(cell.text, 'sql'),
          }}
        />
      )}
    </div>
  )
}

function lineTone(side: 'left' | 'right', op: DdlDiffOp): string {
  switch (op) {
    case 'equal':
      return ''
    case 'replace':
      return side === 'left'
        ? 'bg-destructive/10'
        : 'bg-[var(--chart-green)]/10'
    case 'delete':
      return side === 'left' ? 'bg-destructive/10' : 'bg-muted/30'
    case 'insert':
      return side === 'right' ? 'bg-[var(--chart-green)]/10' : 'bg-muted/30'
    default: {
      const _exhaustive: never = op
      return _exhaustive
    }
  }
}
