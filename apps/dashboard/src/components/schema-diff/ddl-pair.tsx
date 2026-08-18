import type { TableDiff } from '@/lib/schema-diff'

import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { Card, CardContent } from '@/components/ui/card'

interface DdlPairProps {
  selected: TableDiff
}

export function DdlPair({ selected }: DdlPairProps) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card className="rounded-xl border bg-card shadow-sm">
        <CardContent className="p-4">
          <p className="mb-2 text-xs text-muted-foreground">Source DDL</p>
          {selected.source?.createTableQuery ? (
            <CodeBlock code={selected.source.createTableQuery} language="sql">
              <CodeBlockCopyButton />
            </CodeBlock>
          ) : (
            <p className="text-sm text-muted-foreground">Not on source</p>
          )}
        </CardContent>
      </Card>
      <Card className="rounded-xl border bg-card shadow-sm">
        <CardContent className="p-4">
          <p className="mb-2 text-xs text-muted-foreground">Target DDL</p>
          {selected.target?.createTableQuery ? (
            <CodeBlock code={selected.target.createTableQuery} language="sql">
              <CodeBlockCopyButton />
            </CodeBlock>
          ) : (
            <p className="text-sm text-muted-foreground">Not on target</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
