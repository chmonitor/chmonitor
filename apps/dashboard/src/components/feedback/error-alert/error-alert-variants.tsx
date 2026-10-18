export type ErrorAlertVariant = 'default' | 'destructive' | 'warning' | 'info'

const VARIANT_STYLES: Record<ErrorAlertVariant, string> = {
  warning:
    'border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-50',
  info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-50',
  destructive:
    'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-50',
  default: 'border-border bg-card text-card-foreground',
}

/**
 * Get the CSS classes for a given variant
 */
export function getVariantStyles(
  variant: ErrorAlertVariant = 'default'
): string {
  return VARIANT_STYLES[variant]
}
