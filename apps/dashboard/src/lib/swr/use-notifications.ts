/**
 * Notifications Hook
 *
 * Fetches notifications/alerts across all clusters via SWR with appropriate caching.
 * Uses a 30-second refresh interval for critical operational metrics.
 *
 * Notifications include:
 * - Readonly tables warnings across all clusters
 * - Future: replication issues, ZooKeeper problems, etc.
 *
 * Features:
 * - Filters out dismissed notifications (stored in localStorage)
 * - Provides dismiss functionality
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { Notification } from '@/lib/notifications/dismissed-notifications'

import { apiFetch } from './api-fetch'
import { useEffect, useState } from 'react'
import { subscribeInAppAlerts } from '@/lib/health/alert-dispatcher'
import {
  dismissNotification as dismissNotificationUtil,
  filterActiveNotifications,
  getNotificationKey,
} from '@/lib/notifications/dismissed-notifications'
import { REFRESH_INTERVAL, visibilityAwareInterval } from '@/lib/swr/config'

// Extended notification with required key for UI
export interface NotificationWithKey extends Omit<Notification, 'key'> {
  readonly key: string
}

interface NotificationsResult {
  readonly notifications: readonly NotificationWithKey[]
  readonly totalCount: number
  isLoading: boolean
  error?: Error
  /** Mutate function to manually refresh the data */
  refresh: () => void
  /** Dismiss a specific notification */
  dismiss: (notification: NotificationWithKey) => void
  /** Dismiss all current notifications */
  dismissAll: () => void
}

interface NotificationsResponse {
  success: boolean
  data: {
    notifications: readonly Notification[]
    totalCount: number
  }
  error?: { message: string }
}

/**
 * Fetches notifications across all clusters.
 *
 * Features:
 * - 30-second refresh interval (critical operational data)
 * - 15-second deduping to prevent duplicate requests
 * - Revalidates on focus (critical metrics should be fresh)
 * - Filters out dismissed notifications
 * - Returns empty array on error to prevent UI disruption
 *
 * @param hostId - The current host ID
 */
export function useNotifications(hostId: number): NotificationsResult {
  const queryClient = useQueryClient()
  const queryKey = [`/api/v1/notifications?hostId=${hostId}`]
  const { data, error, isLoading } = useQuery<NotificationsResponse>({
    queryKey,
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/notifications?hostId=${hostId}`)
      if (!res.ok) {
        throw new Error('Failed to fetch notifications')
      }
      return res.json()
    },
    refetchInterval: visibilityAwareInterval(REFRESH_INTERVAL.MEDIUM_30S),
    staleTime: 15_000, // 15 seconds deduping
    refetchOnWindowFocus: true, // Revalidate on focus for critical metrics
    refetchOnReconnect: true, // Revalidate on reconnect
    retry: 2, // Retry on error for critical data, limit retries
  })

  const mutate = () => queryClient.invalidateQueries({ queryKey })

  // In-memory store of health-check alerts emitted via CustomEvent
  const [healthAlerts, setHealthAlerts] = useState<Notification[]>([])
  useEffect(() => {
    return subscribeInAppAlerts((alert) => {
      const n: Notification = {
        type: 'health-check',
        cluster: `host-${alert.hostId}`,
        count: alert.value ?? 0,
        severity: alert.severity,
        checkId: alert.checkId,
        incidentId: alert.incidentId,
        label: `${alert.title}: ${alert.label}`,
      }
      setHealthAlerts((prev) => {
        // Replace older incidents for the same check+severity so the bell only
        // shows the latest occurrence (older incidents may have been dismissed).
        const filtered = prev.filter(
          (p) =>
            !(
              p.type === 'health-check' &&
              p.checkId === n.checkId &&
              p.severity === n.severity &&
              p.cluster === n.cluster
            )
        )
        return [n, ...filtered].slice(0, 50)
      })
    })
  }, [])

  // Add unique keys to notifications and filter out dismissed ones
  const notifications = (() => {
    const hostCluster = `host-${hostId}`
    const rawNotifications = [
      ...healthAlerts.filter((n) => n.cluster === hostCluster),
      ...(data?.data?.notifications ?? []),
    ]

    // Add unique keys to each notification
    const withKeys: NotificationWithKey[] = rawNotifications.map((n) => ({
      ...n,
      key: getNotificationKey(n),
    }))

    // Filter out dismissed notifications
    return filterActiveNotifications(withKeys)
  })()

  const totalCount = notifications.length

  // Dismiss a specific notification
  const dismiss = (notification: NotificationWithKey) => {
    dismissNotificationUtil(notification)
    // Trigger revalidation to update the UI
    mutate()
  }

  // Dismiss all current notifications
  const dismissAll = () => {
    for (const notification of notifications) {
      dismissNotificationUtil(notification)
    }
    // Trigger revalidation to update the UI
    mutate()
  }

  return {
    notifications,
    totalCount,
    isLoading,
    error: error ?? undefined,
    refresh: () => mutate(),
    dismiss,
    dismissAll,
  }
}
