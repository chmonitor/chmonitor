import { ExplainTree } from './explain-tree'
import { countNodes, parseExplainTree } from './parse-explain-tree'
import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

type ViewMode = 'tree' | 'text'

/**
 * Render an EXPLAIN result. The API returns one row per output line; the raw
 * text is reconstructed by joining them. PLAN and PIPELINE output is indented
 * and renders as a collapsible tree; a Tree | Text toggle keeps the raw text
 * available. AST / SYNTAX / JSON output is flat or non-hierarchical, so the
 * tree toggle is hidden and only text is shown.
 */
export function ExplainResult({
  lines,
  title,
  treeRenderable,
}: {
  lines: string[]
  title: string
  treeRenderable: boolean
}) {
  const text = useMemo(() => lines.join('\n'), [lines])

  const tree = useMemo(
    () => (treeRenderable ? parseExplainTree(lines) : []),
    [lines, treeRenderable]
  )

  // A tree only adds value when it actually nests (more than just flat roots).
  const hasNesting = useMemo(
    () => tree.some((n) => n.children.length > 0),
    [tree]
  )
  const showTreeToggle = treeRenderable && hasNesting && countNodes(tree) > 0

  const [view, setView] = useState<ViewMode>('tree')
  const effectiveView: ViewMode = showTreeToggle ? view : 'text'

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-lg">{title}</CardTitle>
        {showTreeToggle && (
          <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="tree">Tree</TabsTrigger>
              <TabsTrigger value="text">Text</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </CardHeader>
      <CardContent>
        {effectiveView === 'tree' ? (
          <div className="bg-muted rounded-md p-4">
            <ExplainTree nodes={tree} />
          </div>
        ) : (
          <pre
            className={cn(
              'bg-muted overflow-x-auto rounded-md p-4',
              'font-mono text-sm whitespace-pre-wrap'
            )}
          >
            {text}
          </pre>
        )}
      </CardContent>
    </Card>
  )
}
