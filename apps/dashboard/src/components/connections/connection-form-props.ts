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
  /** Add-host only; never passed when editing a connection. */
  showSamplePreset?: boolean
  /** Set by AddHostDialog only when `CHM_FEATURE_POSTGRES_SOURCE` is on. */
  allowPostgres?: boolean
  /** Add-host only: the PeerDB link is set at create time. */
  allowPeerdb?: boolean
  initialPreset?: ConnectionPreset
  onEngineChange?: (preset: ConnectionPreset) => void
}
