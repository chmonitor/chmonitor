import { Skeleton } from '@/components/ui/skeleton'

export { Skeleton }

// The chart skeleton must match the rendered ChartCard frame exactly to avoid a
// load→render size flash, so use the typed, frame-matched implementation in
// ./chart (it honors `type` to mirror area/bar/line/metric/table layouts).
// The previous inline placeholder here used a default shadcn <Card> (py-6,
// shadow, fixed h-48) that mismatched the chart card and caused the flash.
export { ChartSkeleton, type ChartSkeletonType } from './chart'
// Additional page-scoped skeletons re-exported from their sub-files.
export { ExplorerSkeleton } from './explorer'
export {
  AgentsPageSkeleton,
  ChartsOnlyPageSkeleton,
  PageSkeleton,
  TableOnlyPageSkeleton,
} from './page'
export { SidebarSkeleton } from './sidebar'
// Re-export the shape-matched TableSkeleton (header area, column headers,
// row stagger, pagination footer, a11y attributes) so all consumers get a
// skeleton that mirrors the real DataTable layout and avoids CLS.
export { TableSkeleton } from './table'
export { TabsSkeleton } from './tabs'
export { ListSkeleton, MultiLineSkeleton, SingleLineSkeleton } from './ui'
