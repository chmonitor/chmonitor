const KIND_BADGE: Record<string, string> = {
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

const TYPE_BADGE: Record<string, string> = {
  QueryFinish:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  QueryStart:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  ExceptionWhileProcessing:
    'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  ExceptionBeforeStart:
    'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
}

export function typeBadgeClass(type: string): string {
  return TYPE_BADGE[type] ?? 'bg-muted text-muted-foreground'
}

export function toNumber(v: unknown): number {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function toStr(v: unknown): string {
  if (v == null) return ''
  return String(v)
}
