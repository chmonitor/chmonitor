/** The default empty-state copy shared by the query tables. */
export const NO_QUERIES_MESSAGE = 'No queries match your filters'

/**
 * Copy for when the underlying data set itself is empty (no rows fetched at
 * all), as opposed to `NO_QUERIES_MESSAGE` which covers a non-empty data set
 * filtered down to zero visible rows.
 */
export const NO_ACTIVE_QUERIES_MESSAGE =
  'Nothing is executing on this host right now. New queries appear here automatically.'

/** Empty-state for the card list — a centered muted message. */
export function EmptyCards({
  message = NO_QUERIES_MESSAGE,
}: {
  message?: string
}) {
  return (
    <div className="px-6 py-12 text-center text-[13px] text-muted-foreground">
      {message}
    </div>
  )
}

/** Empty-state for a `<table>` body — a single full-width row. */
export function EmptyTableRow({
  colSpan,
  message = NO_QUERIES_MESSAGE,
}: {
  colSpan: number
  message?: string
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-6 py-12 text-center text-[13px] text-muted-foreground"
      >
        {message}
      </td>
    </tr>
  )
}
