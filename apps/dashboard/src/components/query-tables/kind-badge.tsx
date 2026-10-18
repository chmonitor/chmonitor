import { cn } from '@/lib/utils'

export const KIND_BADGE: Record<string, string> = {
  Select: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  Insert:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  Create:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Optimize:
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  Alter:
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  Drop: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  Delete: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
}

export function kindBadgeClass(kind: string): string {
  return KIND_BADGE[kind] ?? 'bg-muted text-muted-foreground'
}

export function KindBadge({ kind }: { kind: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide',
        kindBadgeClass(kind)
      )}
    >
      {kind}
    </span>
  )
}
