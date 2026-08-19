'use client'

/**
 * Copyable recommend-only DDL: single-host statement plus, when topology is
 * known, an ON CLUSTER variant. Never an apply/run control.
 */

import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'

export interface RecommendDdlBlocksProps {
  statement: string
  onClusterStatement?: string | null
  localTableName?: string | null
  localOnlyReason?: string | null
}

export function RecommendDdlBlocks({
  statement,
  onClusterStatement,
  localTableName,
  localOnlyReason,
}: RecommendDdlBlocksProps) {
  if (!statement) return null

  return (
    <div className="space-y-2">
      {localTableName ? (
        <p className="text-xs text-muted-foreground">
          Local table{' '}
          <span className="font-medium text-foreground">{localTableName}</span>
        </p>
      ) : null}
      <CodeBlock code={statement} language="sql" className="max-h-56 text-xs">
        <CodeBlockCopyButton />
      </CodeBlock>
      {onClusterStatement ? (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">
            ON CLUSTER
          </div>
          <CodeBlock
            code={onClusterStatement}
            language="sql"
            className="max-h-56 text-xs"
          >
            <CodeBlockCopyButton />
          </CodeBlock>
        </div>
      ) : localOnlyReason ? (
        <p className="text-xs text-muted-foreground">{localOnlyReason}</p>
      ) : null}
    </div>
  )
}
