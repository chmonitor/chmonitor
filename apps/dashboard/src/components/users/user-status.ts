/** Badge classes per users-page status value; hashed colours would be arbitrary. */

export const STATUS_TONES: Record<string, string> = {
  active:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  idle: 'bg-muted text-muted-foreground',
  inactive: 'border border-border bg-transparent text-muted-foreground',
}

export const EXPIRY_TONES: Record<string, string> = {
  never: 'bg-muted text-muted-foreground',
  valid: 'bg-muted text-muted-foreground',
  expiring:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  expired: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
}
