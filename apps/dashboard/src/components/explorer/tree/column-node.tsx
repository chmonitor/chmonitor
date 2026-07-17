import { ColumnsIcon, KeyIcon } from 'lucide-react'

import { TreeNode } from './tree-node'
import { Badge } from '@/components/ui/badge'

interface ColumnNodeProps {
  name: string
  type: string
  isInPrimaryKey?: boolean
  isInSortingKey?: boolean
  level: number
  /** 1-indexed position among sibling columns, for `aria-posinset`. */
  posInSet?: number
  /** Total count of sibling columns, for `aria-setsize`. */
  setSize?: number
}

export const ColumnNode = function ColumnNode({
  name,
  type,
  isInPrimaryKey,
  isInSortingKey,
  level,
  posInSet,
  setSize,
}: ColumnNodeProps) {
  const icon = isInPrimaryKey || isInSortingKey ? KeyIcon : ColumnsIcon

  return (
    <TreeNode
      label={name}
      icon={icon}
      level={level}
      posInSet={posInSet}
      setSize={setSize}
      badge={
        <Badge variant="outline" className="text-xs">
          {type}
        </Badge>
      }
    />
  )
}
