import { Eye, EyeOff, FlaskConical } from 'lucide-react'

import type { BrowserConnection } from '@/lib/types/browser-connection'
import type { ConnectionFormProps } from './connection-form-props'
import type { ConnectionFormData } from './connection-form-schema'
import type { ConnectionPreset } from './connection-presets'

import { ConnectionFieldsClickHouse } from './connection-fields-clickhouse'
import { ConnectionFieldsPostgres } from './connection-fields-postgres'
import { ConnectionPeerdbFields } from './connection-peerdb-fields'
import { POSTGRES_DEFAULT_PORT } from './connection-presets'
import { ConnectionStoragePreference } from './connection-storage-preference'
import { ConnectionTestSection } from './connection-test-section'
import { useConnectionFormActions } from './use-connection-form-actions'
import { useConnectionTest } from './use-connection-test'
import { usePeerdbConnection } from './use-peerdb-connection'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type { BrowserConnection }

export type { ConnectionFormProps } from './connection-form-props'
export type { ConnectionFormData } from './connection-form-schema'

export function ConnectionForm({
  onSave,
  initialValues,
  onCancel,
  storageMode = 'browser',
  onStorageModeChange,
  dbStorageEnabled = false,
  dbStorageRequiresSignIn = false,
  showSamplePreset = false,
  allowPostgres = false,
  allowPeerdb = false,
  initialPreset = 'self-hosted',
  onEngineChange,
}: ConnectionFormProps) {
  const [form, setForm] = useState<ConnectionFormData>({
    name: initialValues?.name ?? '',
    host: initialValues?.host ?? '',
    // Seed the Postgres field defaults up front when the dialog opens straight
    // on the Postgres tab (setup page "Connect Postgres" CTA), mirroring what
    // `handlePresetChange('postgres')` would apply on a manual tab switch.
    user:
      initialValues?.user ?? (initialPreset === 'postgres' ? 'postgres' : ''),
    password: initialValues?.password ?? '',
    port:
      initialValues?.port ??
      (initialPreset === 'postgres' ? POSTGRES_DEFAULT_PORT : undefined),
    database: initialValues?.database ?? '',
    sslmode: initialValues?.sslmode ?? 'require',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [preset, setPreset] = useState<ConnectionPreset>(initialPreset)
  const [saving, setSaving] = useState(false)

  const isPostgres = preset === 'postgres'

  const { testStatus, resetTestStatus, handleTest } = useConnectionTest(
    form,
    isPostgres
  )
  const peerdb = usePeerdbConnection(initialValues, allowPeerdb)
  const {
    handleChange,
    handlePresetChange,
    handleHostBlur,
    handleUseSample,
    handleSave,
    chFormValid,
    valid,
  } = useConnectionFormActions({
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
  })

  // Keep the parent (AddHostDialog) in sync with the initial engine on mount so
  // its title / description / help panel match the tab the dialog opened on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only sync
  useEffect(() => {
    onEngineChange?.(initialPreset)
  }, [])

  return (
    <div className="space-y-4">
      {/* Connection type — presets only change defaults/hints below; the
          self-hosted preset (default) leaves every field untouched. */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Connection type</Label>
        <Tabs
          value={preset}
          onValueChange={(v) => handlePresetChange(v as ConnectionPreset)}
        >
          <TabsList>
            <TabsTrigger value="self-hosted">Self-hosted</TabsTrigger>
            <TabsTrigger value="clickhouse-cloud">ClickHouse Cloud</TabsTrigger>
            {allowPostgres && (
              <TabsTrigger value="postgres" data-testid="engine-postgres">
                Postgres
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
      </div>

      {showSamplePreset && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-xs font-medium">No cluster handy?</p>
            <p className="text-xs text-muted-foreground">
              Try the public, read-only ClickHouse Playground — schema browsing
              and SQL, no setup.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={handleUseSample}
            data-testid="use-sample-preset"
          >
            <FlaskConical className="size-3.5" />
            Use sample
          </Button>
        </div>
      )}

      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="conn-name" className="text-sm font-medium">
          Name
        </Label>
        <Input
          id="conn-name"
          placeholder="My ClickHouse"
          value={form.name}
          onChange={handleChange('name')}
          autoComplete="off"
        />
      </div>

      {/* Host — a full URL for ClickHouse, a bare hostname + port for Postgres. */}
      {isPostgres ? (
        <ConnectionFieldsPostgres
          form={form}
          setForm={setForm}
          onHostChange={handleChange('host')}
          onDatabaseChange={handleChange('database')}
        />
      ) : (
        <ConnectionFieldsClickHouse
          form={form}
          preset={preset}
          onHostChange={handleChange('host')}
          onHostBlur={handleHostBlur}
        />
      )}

      {/* Username */}
      <div className="space-y-1.5">
        <Label htmlFor="conn-user" className="text-sm font-medium">
          Username
        </Label>
        <Input
          id="conn-user"
          placeholder="default"
          value={form.user}
          onChange={handleChange('user')}
          autoComplete="username"
        />
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <Label htmlFor="conn-password" className="text-sm font-medium">
          Password
        </Label>
        <div className="relative">
          <Input
            id="conn-password"
            type={showPassword ? 'text' : 'password'}
            placeholder="••••••••"
            value={form.password}
            onChange={handleChange('password')}
            className="pr-9"
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
      </div>

      {/* Storage preference */}
      {onStorageModeChange && (
        <ConnectionStoragePreference
          storageMode={storageMode}
          onStorageModeChange={onStorageModeChange}
          dbStorageEnabled={dbStorageEnabled}
          dbStorageRequiresSignIn={dbStorageRequiresSignIn}
        />
      )}

      {storageMode === 'browser' && (
        <p className="text-xs text-muted-foreground">
          Credentials are encrypted in this browser. Session tokens are used for
          API requests (password not sent on every query).
        </p>
      )}

      {/* Advanced → PeerDB monitoring (optional). Collapsed by default; shown
          for every connection type when the caller opts in. */}
      {allowPeerdb && (
        <ConnectionPeerdbFields
          advancedOpen={peerdb.advancedOpen}
          setAdvancedOpen={peerdb.setAdvancedOpen}
          peerdbApiUrl={peerdb.peerdbApiUrl}
          setPeerdbApiUrl={peerdb.setPeerdbApiUrl}
          peerdbAuthUi={peerdb.peerdbAuthUi}
          setPeerdbAuthUi={peerdb.setPeerdbAuthUi}
          peerdbSecret={peerdb.peerdbSecret}
          setPeerdbSecret={peerdb.setPeerdbSecret}
          peerdbTest={peerdb.peerdbTest}
          setPeerdbTest={peerdb.setPeerdbTest}
          handleTestPeerdb={peerdb.handleTestPeerdb}
        />
      )}

      <ConnectionTestSection
        testStatus={testStatus}
        onTest={handleTest}
        disabled={!chFormValid}
        cloudPreset={preset === 'clickhouse-cloud'}
      />

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave} disabled={!valid || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
