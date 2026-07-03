/**
 * Dashboard storage types.
 *
 * A "dashboard" here is a saved Chart Builder layout: a named, ordered list
 * of chart identifiers (`charts: string[]`). Schema design mirrors
 * `conversation-store/types.ts`:
 *   - `id` is the server-minted, globally-unique primary key. It is never
 *     accepted from a client — routes resolve/mint it internally via an
 *     owner-scoped `(ownerId, name)` lookup — so there is no id-collision
 *     surface for an upsert guard to defend against on the write path (unlike
 *     conversations, whose `id` IS client-supplied). The guard is kept anyway
 *     as defense-in-depth (see `d1-store.ts`).
 *   - `ownerId` scopes every read/write.
 *   - Sharing is read-only: a shared dashboard exposes only `name` + `charts`
 *     to anonymous viewers via `shareSlug`, never `ownerId` or any other
 *     owner-identifying field.
 */

export interface StoredDashboard {
  id: string
  ownerId: string
  name: string
  charts: string[]
  isShared: boolean
  shareSlug: string | null
  updatedAt: number
}

/**
 * Minimal projection served by the public, unauthenticated share-link GET.
 * Deliberately excludes `id`, `ownerId`, `isShared`, `shareSlug`, `updatedAt`
 * — an anonymous viewer must never learn anything beyond the dashboard's
 * own content.
 */
export interface PublicSharedDashboard {
  name: string
  charts: string[]
}

/**
 * Dashboard storage adapter interface. `D1DashboardStore` (server-only) is
 * the sole persistent backend today (Postgres is explicitly out of scope —
 * see plans/56-dashboard-d1-persistence-sharing.md); the client-side
 * fallback when D1 is unavailable is `local-store.ts` (localStorage), which
 * does not implement this interface (it has no owner/sharing concept).
 */
export interface DashboardStore {
  list(ownerId: string): Promise<StoredDashboard[]>
  get(ownerId: string, name: string): Promise<StoredDashboard | null>
  /**
   * Create-or-update by name (mirrors the localStorage "same name
   * overwrites" behavior). Mints a new `id` on first save; reuses the
   * existing one on subsequent saves. Never takes a client-supplied id.
   */
  saveByName(
    ownerId: string,
    name: string,
    charts: string[]
  ): Promise<StoredDashboard>
  /**
   * Low-level upsert primitive, mirroring
   * `conversation-store/d1-store.ts`'s `D1_UPSERT_CONVERSATION_SQL`: the
   * `ON CONFLICT ... WHERE owner_id = excluded.owner_id` guard blocks a
   * write from reassigning a row owned by a different owner.
   */
  upsert(dashboard: StoredDashboard): Promise<{ written: boolean }>
  delete(ownerId: string, name: string): Promise<void>
  /**
   * Enable or revoke read-only sharing. Enabling is idempotent (an
   * already-shared dashboard keeps its existing slug rather than rotating
   * it). Revoking clears `shareSlug` in the same write as `isShared = false`
   * so a revoked link can never resurface.
   */
  setSharing(
    ownerId: string,
    name: string,
    shared: boolean
  ): Promise<StoredDashboard | null>
  /**
   * Public, unauthenticated read by share slug. Returns `null` when the
   * slug is unknown OR sharing was revoked — callers must not distinguish
   * the two (avoids leaking whether a slug ever existed).
   */
  getByShareSlug(slug: string): Promise<PublicSharedDashboard | null>
}

export class DashboardStoreError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'UNAUTHORIZED'
      | 'STORAGE_ERROR'
      | 'VALIDATION_ERROR',
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'DashboardStoreError'
  }
}
