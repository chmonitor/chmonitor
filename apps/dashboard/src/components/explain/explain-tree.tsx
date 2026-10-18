import { ChevronDownIcon, ChevronRightIcon } from '@radix-ui/react-icons'

import type { ExplainTreeNode } from './parse-explain-tree'

import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Split a node label into its primary step name and the parenthetical detail
 * ClickHouse appends, e.g. "ReadFromMergeTree (default.hits)" ->
 * { name: "ReadFromMergeTree", detail: "default.hits" }. The detail is shown
 * muted next to the name. Labels without a trailing "(...)" return detail=''.
 */
function splitLabel(label: string): { name: string; detail: string } {
  const match = label.match(/^(.*?)\s*\((.*)\)\s*$/)
  if (match && match[1].length > 0) {
    return { name: match[1].trim(), detail: match[2].trim() }
  }
  return { name: label, detail: '' }
}

function TreeNode({
  node,
  collapsed,
  onToggle,
}: {
  node: ExplainTreeNode
  collapsed: Set<string>
  onToggle: (id: string) => void
}) {
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsed.has(node.id)
  const { name, detail } = splitLabel(node.label)

  return (
    <li className="relative">
      <div
        className={cn(
          'group flex items-start gap-1.5 rounded-md py-1 pr-2 transition-colors',
          'hover:bg-muted/60'
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? 'Expand node' : 'Collapse node'}
            className="text-muted-foreground hover:text-foreground mt-0.5 flex size-4 shrink-0 items-center justify-center"
          >
            {isCollapsed ? (
              <ChevronRightIcon className="size-4" />
            ) : (
              <ChevronDownIcon className="size-4" />
            )}
          </button>
        ) : (
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
            <span className="bg-muted-foreground/40 size-1.5 rounded-full" />
          </span>
        )}

        <span className="min-w-0 font-mono text-sm leading-relaxed">
          <span className="text-foreground font-medium">{name}</span>
          {detail && (
            <span className="text-muted-foreground ml-1.5 break-all">
              {detail}
            </span>
          )}
        </span>
      </div>

      {hasChildren && !isCollapsed && (
        <ul className="border-border/60 ml-[0.4375rem] border-l pl-3">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function ExplainTree({ nodes }: { nodes: ExplainTreeNode[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <ul className="overflow-x-auto">
      {nodes.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          collapsed={collapsed}
          onToggle={toggle}
        />
      ))}
    </ul>
  )
}
