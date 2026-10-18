import {
  AlertTriangleIcon,
  DatabaseIcon,
  type LucideIcon,
  NetworkIcon,
  ShieldAlertIcon,
  ShieldXIcon,
  TimerIcon,
  XCircleIcon,
} from 'lucide-react'

import type { ReactElement } from 'react'

export type ErrorIconType =
  | 'table_not_found'
  | 'permission_error'
  | 'network_error'
  | 'validation_error'
  | 'query_error'
  | 'ssl_error'
  | 'timeout_error'
  | 'default'

const ICON_CLASS_NAME = 'text-muted-foreground h-5 w-5'

const ERROR_ICONS: Record<ErrorIconType, LucideIcon> = {
  table_not_found: DatabaseIcon,
  permission_error: ShieldXIcon,
  network_error: NetworkIcon,
  validation_error: AlertTriangleIcon,
  query_error: XCircleIcon,
  ssl_error: ShieldAlertIcon,
  timeout_error: TimerIcon,
  default: AlertTriangleIcon,
}

/**
 * Get the icon component for a given error type
 */
export function getErrorIcon(errorType?: ErrorIconType): ReactElement {
  const Icon = ERROR_ICONS[errorType || 'default']
  return <Icon className={ICON_CLASS_NAME} />
}
