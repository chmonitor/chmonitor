import { EmptyState } from '@/components/ui/empty-state'

/** Neutral state for replication surfaces on a host with no replicated tables. */
export function ReplicationNotUsed({ compact }: { compact?: boolean }) {
  return (
    <EmptyState
      variant="no-data"
      compact={compact}
      title="Replication not used on this host"
      description="No Replicated or SharedMergeTree tables found, so there is no replication queue to monitor."
    />
  )
}
