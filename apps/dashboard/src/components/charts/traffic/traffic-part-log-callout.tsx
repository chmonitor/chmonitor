import { EmptyState } from '@/components/ui/empty-state'

/**
 * Shown once on /traffic in place of the part_log-backed sections (Bytes on
 * Disk, Merges & Data Movement, Top Tables) when system.part_log is not
 * enabled on the host — a single explanatory callout instead of a wall of
 * empty chart cards.
 */
export function TrafficPartLogCallout() {
  return (
    <EmptyState
      compact
      variant="table-missing"
      title="On-disk traffic sections are hidden"
      description={
        <>
          <code className="text-xs">system.part_log</code> is not enabled on
          this host, so Bytes on Disk, Merges &amp; Data Movement, and Top
          Tables by Ingestion have no data source. Enable it with a{' '}
          <code className="text-xs">&lt;part_log&gt;</code> block in the server
          config, or force these sections from the view settings above.
        </>
      }
      action={{
        label: 'part_log docs',
        onClick: () =>
          window.open(
            'https://clickhouse.com/docs/en/operations/system-tables/part_log',
            '_blank',
            'noopener,noreferrer'
          ),
      }}
    />
  )
}
