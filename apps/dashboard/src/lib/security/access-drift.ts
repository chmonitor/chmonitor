/**
 * Replica drift for the Access matrix (#4123). Grants live per replica when
 * users are defined in users.xml or `local_directory`, so a rollout that
 * reached some replicas leaves them disagreeing. The page reads grants and
 * role grants from every replica (opt-in) and this module compares the
 * EFFECTIVE access each replica gives, using the same computation as the
 * matrix itself (`buildRows` / `computeCell`), not a diff of raw grant rows.
 *
 * A replica that did not answer is skipped. It is never compared as "no
 * grants", which would show every cell as drift.
 */

import type {
  AccessInputs,
  CellAccess,
  Grantee,
  GrantRow,
  RoleGrantRow,
  Scope,
} from './access-matrix'
import type { MatrixRow, UserInfo } from './access-matrix-view'

import { computeCell, summarizeCell } from './access-matrix'
import { buildRows } from './access-matrix-view'
import { pickFanoutCluster } from '@/lib/cluster/pick-fanout-cluster'

export interface ReplicaGrantRow extends GrantRow {
  replica: string
}

export interface ReplicaRoleGrantRow extends RoleGrantRow {
  replica: string
}

export interface ClusterMemberRow {
  cluster: string
  host_name: string
  host_address: string
  port: number
  is_local: number | boolean
}

export type DriftCluster =
  | { cluster: string; members: ClusterMemberRow[]; reason?: undefined }
  | { cluster: null; members: []; reason: string }

const memberKey = (m: { host_name: string; port: number }) =>
  `${m.host_name}:${m.port}`

/** Members of one cluster, one entry per host:port. */
export function clusterMembers(
  rows: ClusterMemberRow[],
  cluster: string
): ClusterMemberRow[] {
  const seen = new Map<string, ClusterMemberRow>()
  for (const r of rows) {
    if (r.cluster === cluster && !seen.has(memberKey(r)))
      seen.set(memberKey(r), r)
  }
  return [...seen.values()]
}

/**
 * The cluster to compare over, or why there is none. Same choice as the
 * node-vs-node diffs: the widest physical cluster, so one fan-out covers
 * every replica.
 */
export function pickDriftCluster(rows: ClusterMemberRow[]): DriftCluster {
  const cluster = pickFanoutCluster(rows)
  if (cluster === null)
    return {
      cluster: null,
      members: [],
      reason:
        'This server has no cluster configured (system.clusters is empty).',
    }
  const members = clusterMembers(rows, cluster)
  if (members.length < 2)
    return {
      cluster: null,
      members: [],
      reason: `The only cluster, ${cluster}, has a single replica, so there is nothing to compare.`,
    }
  return { cluster, members }
}

const truthy = (v: number | boolean) => v === true || v === 1

/**
 * Cluster members that did not answer. `responded` holds hostName() values;
 * a member matches by host_name or host_address. The member this server runs
 * on always answered (the query ran there), whatever name system.clusters
 * gives it.
 */
export function skippedReplicas(
  members: ClusterMemberRow[],
  responded: string[]
): string[] {
  const answered = new Set(responded.map((r) => r.toLowerCase()))
  return members
    .filter(
      (m) =>
        !truthy(m.is_local) &&
        !answered.has(m.host_name.toLowerCase()) &&
        !answered.has(m.host_address.toLowerCase())
    )
    .map(memberKey)
}

export interface ReplicaView {
  /** Replicas whose grants were read, sorted. */
  responded: string[]
  /** Cluster members that did not answer: not compared. */
  skipped: string[]
  /** replica -> grantee name -> the same row the matrix builds. */
  rows: Map<string, Map<string, MatrixRow>>
  /** False when fewer than two replicas answered: nothing to compare. */
  comparable: boolean
}

export interface ReplicaViewInput {
  kind: Grantee['kind']
  grantees: UserInfo[]
  databases: string[]
  grants: ReplicaGrantRow[]
  roleGrants: ReplicaRoleGrantRow[]
  /** hostName() of each replica that answered the probe. */
  responded: string[]
  members: ClusterMemberRow[]
  /** Profiles are read from the selected node and shared by every replica. */
  shared: Pick<AccessInputs, 'profiles' | 'profileElements'>
}

export function buildReplicaView(input: ReplicaViewInput): ReplicaView {
  const replicas = [
    ...new Set([
      ...input.responded,
      ...input.grants.map((g) => g.replica),
      ...input.roleGrants.map((g) => g.replica),
    ]),
  ].sort()
  const rows = new Map<string, Map<string, MatrixRow>>()
  for (const replica of replicas) {
    const inputs: AccessInputs = {
      grants: input.grants.filter((g) => g.replica === replica),
      roleGrants: input.roleGrants.filter((g) => g.replica === replica),
      ...input.shared,
    }
    rows.set(
      replica,
      new Map(
        buildRows(input.kind, input.grantees, input.databases, inputs).map(
          (row) => [row.access.grantee.name, row]
        )
      )
    )
  }
  return {
    responded: replicas,
    skipped: skippedReplicas(input.members, replicas),
    rows,
    comparable: replicas.length >= 2,
  }
}

export interface ReplicaCell {
  replica: string
  cell: CellAccess
  summary: string
}

export interface CellDrift {
  drifted: boolean
  replicas: ReplicaCell[]
}

/** What "effective access differs" means for a cell. */
const signature = (c: CellAccess) =>
  `${c.level}|${c.partialRevoke}|${c.narrowerGrants}`

export function cellDrift(
  view: ReplicaView,
  grantee: string,
  scope: Scope
): CellDrift {
  const replicas: ReplicaCell[] = []
  for (const replica of view.responded) {
    const row = view.rows.get(replica)?.get(grantee)
    if (!row) continue
    const cell = computeCell(row.access.sourced, scope, row.access.readonly)
    replicas.push({ replica, cell, summary: summarizeCell(cell) })
  }
  const drifted =
    view.comparable && new Set(replicas.map((r) => signature(r.cell))).size > 1
  return { drifted, replicas }
}

/** Databases of a grantee whose access differs between replicas. */
export function granteeDriftDatabases(
  view: ReplicaView,
  grantee: string,
  databases: string[]
): string[] {
  if (!view.comparable) return []
  return databases.filter(
    (database) => cellDrift(view, grantee, { database }).drifted
  )
}
