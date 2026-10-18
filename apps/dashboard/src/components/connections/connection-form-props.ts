import type { HostStorageMode } from '@/lib/types/host-storage'
import type { ConnectionFormData } from './connection-form-schema'
import type { ConnectionPreset } from './connection-presets'

export interface ConnectionFormProps {
  onSave: (data: ConnectionFormData) => void | Promise<void>
  initialValues?: Partial<ConnectionFormData>
  onCancel: () => void
  storageMode?: HostStorageMode
  onStorageModeChange?: (mode: HostStorageMode) => void
  dbStorageEnabled?: boolean
  dbStorageRequiresSignIn?: boolean
  /**
   * Show a "Try sample ClickHouse (read-only)" quick-fill affordance that
   * loads `SAMPLE_CLUSTER_PRESET` into the form. Only appropriate for an "add
   * new host" context (`AddHostDialog`) — never passed when editing an
   * existing connection.
   */
  showSamplePreset?: boolean
  /**
   * Show the flag-gated Postgres option in the connection-type selector. Only
   * the "add new host" path (`AddHostDialog`) passes this when
   * `CHM_FEATURE_POSTGRES_SOURCE` is on; everything else keeps the ClickHouse-
   * only UI, so there is zero visual change when the flag is off.
   */
  allowPostgres?: boolean
  /**
   * Show the "Advanced" collapsible with the optional "PeerDB monitoring"
   * fields (API URL + auth + Test PeerDB). Off by default; the "add new host"
   * path (`AddHostDialog`) opts in. Editing dialogs leave it off for now — the
   * PeerDB link is set at create time (see PR notes / follow-up).
   */
  allowPeerdb?: boolean
  initialPreset?: ConnectionPreset
  onEngineChange?: (preset: ConnectionPreset) => void
}
