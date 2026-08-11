import type { Dispatch, SetStateAction } from 'react'
import type { ConnectionFormData } from './connection-form-schema'
import type { ConnectionPreset } from './connection-presets'
import type { usePeerdbConnection } from './use-peerdb-connection'

import { isFormValid } from './connection-form-schema'
import {
  applyCloudHostDefaults,
  engineForPreset,
  POSTGRES_DEFAULT_PORT,
} from './connection-presets'
import { SAMPLE_CLUSTER_PRESET } from './sample-preset'

/**
 * Field-change / preset-change / save handlers for `ConnectionForm`.
 * Extracted verbatim from `ConnectionForm`; behavior is unchanged — same
 * validation, same envelope shape sent to `onSave`, same test-status reset
 * timing.
 */
export function useConnectionFormActions({
  form,
  setForm,
  preset,
  setPreset,
  isPostgres,
  saving,
  setSaving,
  onSave,
  onEngineChange,
  resetTestStatus,
  peerdb,
}: {
  form: ConnectionFormData
  setForm: Dispatch<SetStateAction<ConnectionFormData>>
  preset: ConnectionPreset
  setPreset: Dispatch<SetStateAction<ConnectionPreset>>
  isPostgres: boolean
  saving: boolean
  setSaving: Dispatch<SetStateAction<boolean>>
  onSave: (data: ConnectionFormData) => void | Promise<void>
  onEngineChange?: (preset: ConnectionPreset) => void
  resetTestStatus: () => void
  peerdb: ReturnType<typeof usePeerdbConnection>
}) {
  const handleChange =
    (field: keyof ConnectionFormData) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
      // Reset test status when form changes
      resetTestStatus()
    }

  const handlePresetChange = (next: ConnectionPreset) => {
    setPreset(next)
    resetTestStatus()
    onEngineChange?.(next)
    // Only fill a still-empty username — never clobber an existing value
    // (e.g. while editing an existing connection via ConnectionManagerDialog).
    if (next === 'clickhouse-cloud') {
      setForm((prev) =>
        prev.user.trim() ? prev : { ...prev, user: 'default' }
      )
    } else if (next === 'postgres') {
      setForm((prev) => ({
        ...prev,
        user: prev.user.trim() ? prev.user : 'postgres',
        port: prev.port ?? POSTGRES_DEFAULT_PORT,
        sslmode: prev.sslmode ?? 'require',
      }))
    }
  }

  // Normalize the host on blur (not on every keystroke, so we never fight the
  // cursor while typing) so a pasted Cloud hostname connects on the first
  // try. Never runs for the self-hosted preset — that path is untouched.
  const handleHostBlur = () => {
    if (preset !== 'clickhouse-cloud') return
    setForm((prev) => {
      const next = applyCloudHostDefaults(prev.host)
      return next === prev.host ? prev : { ...prev, host: next }
    })
  }

  const handleUseSample = () => {
    setForm({ ...SAMPLE_CLUSTER_PRESET })
    resetTestStatus()
  }

  const handleSave = async () => {
    if (!isFormValid(form, isPostgres) || !peerdb.peerdbValid || saving) return
    setSaving(true)
    try {
      await onSave(
        isPostgres
          ? {
              name: form.name.trim(),
              host: form.host.trim(),
              user: form.user.trim(),
              password: form.password,
              engine: 'postgres',
              port: form.port ?? POSTGRES_DEFAULT_PORT,
              database: (form.database ?? '').trim(),
              sslmode: form.sslmode,
              ...peerdb.peerdbFields(),
            }
          : {
              name: form.name.trim(),
              host: form.host.trim(),
              user: form.user.trim(),
              password: form.password,
              engine: engineForPreset(preset),
              ...peerdb.peerdbFields(),
            }
      )
    } finally {
      setSaving(false)
    }
  }

  const chFormValid = isFormValid(form, isPostgres)
  const valid = chFormValid && peerdb.peerdbValid

  return {
    handleChange,
    handlePresetChange,
    handleHostBlur,
    handleUseSample,
    handleSave,
    chFormValid,
    valid,
  }
}
