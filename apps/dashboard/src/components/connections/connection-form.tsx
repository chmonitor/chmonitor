import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FlaskConical,
  Globe,
  Loader2,
  Waypoints,
} from 'lucide-react'

import type { BrowserConnection } from '@/lib/types/browser-connection'
import type { HostStorageMode } from '@/lib/types/host-storage'
import type { ConnectionPreset } from './connection-presets'

import {
  applyCloudHostDefaults,
  CLOUD_HOST_PLACEHOLDER,
  engineForPreset,
  POSTGRES_DEFAULT_PORT,
  POSTGRES_HOST_PLACEHOLDER,
  SELF_HOSTED_HOST_PLACEHOLDER,
} from './connection-presets'
import { SAMPLE_CLUSTER_PRESET } from './sample-preset'
import { useEffect, useState } from 'react'
import { BrokenWireIllustration } from '@/components/illustrations/broken-wire-illustration'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  classifyConnectionError,
  extractConnectionErrorMessage,
} from '@/lib/connection-errors'
import { docsSiteUrl } from '@/lib/docs-site'
import { apiFetch } from '@/lib/swr/api-fetch'
import {
  detectChFlavor,
  getDeployTarget,
  parseMajorMinor,
  track,
} from '@/lib/telemetry'

export type { BrowserConnection }

export type ConnectionFormData = Pick<
  BrowserConnection,
  | 'name'
  | 'host'
  | 'user'
  | 'password'
  | 'engine'
  | 'port'
  | 'database'
  | 'sslmode'
  | 'peerdbApiUrl'
  | 'peerdbAuthScheme'
  | 'peerdbAuthSecret'
>

/** UI value for the PeerDB auth selector; `none` maps to no stored secret. */
type PeerdbAuthUi = 'none' | 'basic' | 'bearer'

/** libpq sslmodes surfaced in the Postgres preset's SSL dropdown. */
const POSTGRES_SSLMODES = ['require', 'disable', 'verify-full'] as const

interface TestStatus {
  state: 'idle' | 'loading' | 'success' | 'error'
  message?: string
}

interface ConnectionFormProps {
  onSave: (data: ConnectionFormData) => void | Promise<void>
  initialValues?: Partial<ConnectionFormData>
  onCancel: () => void
  storageMode?: HostStorageMode
  onStorageModeChange?: (mode: HostStorageMode) => void
  dbStorageEnabled?: boolean
  /** Server storage is configured but the user must sign in first. */
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
  /**
   * Connection-type tab to start on (e.g. the setup page's "Connect Postgres"
   * CTA opens the dialog straight on the Postgres tab). Users can still switch
   * tabs afterwards. Defaults to `'self-hosted'`.
   */
  initialPreset?: ConnectionPreset
  /**
   * Notified whenever the active connection-type preset changes (and once on
   * mount) so the parent dialog can react — engine-aware title, description and
   * help panel.
   */
  onEngineChange?: (preset: ConnectionPreset) => void
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isFormValid(data: ConnectionFormData, isPostgres: boolean): boolean {
  const base = data.name.trim().length > 0 && data.user.trim().length > 0
  if (isPostgres) {
    // Postgres uses a bare hostname (not a URL) plus a required database.
    return (
      base &&
      (data.host ?? '').trim().length > 0 &&
      (data.database ?? '').trim().length > 0
    )
  }
  return base && isValidUrl((data.host ?? '').trim())
}

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
  const [testStatus, setTestStatus] = useState<TestStatus>({ state: 'idle' })
  const [preset, setPreset] = useState<ConnectionPreset>(initialPreset)

  // Advanced → PeerDB monitoring (optional). `none` means "no auth" (open
  // flow-api); the secret is only kept for `basic`/`bearer`.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [peerdbApiUrl, setPeerdbApiUrl] = useState(
    initialValues?.peerdbApiUrl ?? ''
  )
  const [peerdbAuthUi, setPeerdbAuthUi] = useState<PeerdbAuthUi>(
    initialValues?.peerdbAuthScheme ?? 'none'
  )
  const [peerdbSecret, setPeerdbSecret] = useState(
    initialValues?.peerdbAuthSecret ?? ''
  )
  const [peerdbTest, setPeerdbTest] = useState<TestStatus>({ state: 'idle' })

  const isPostgres = preset === 'postgres'

  // Keep the parent (AddHostDialog) in sync with the initial engine on mount so
  // its title / description / help panel match the tab the dialog opened on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only sync
  useEffect(() => {
    onEngineChange?.(initialPreset)
  }, [])

  const handleChange =
    (field: keyof ConnectionFormData) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
      // Reset test status when form changes
      if (testStatus.state !== 'idle') {
        setTestStatus({ state: 'idle' })
      }
    }

  const handlePresetChange = (next: ConnectionPreset) => {
    setPreset(next)
    setTestStatus({ state: 'idle' })
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
    setTestStatus({ state: 'idle' })
  }

  const handleTest = async () => {
    setTestStatus({ state: 'loading' })
    try {
      const response = await apiFetch('/api/v1/browser-connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isPostgres
            ? {
                engine: 'postgres',
                host: form.host.trim(),
                port: form.port ?? POSTGRES_DEFAULT_PORT,
                user: form.user.trim(),
                password: form.password,
                database: (form.database ?? '').trim(),
                sslmode: form.sslmode,
              }
            : {
                host: form.host.trim(),
                user: form.user.trim(),
                password: form.password,
              }
        ),
      })
      const json = (await response.json()) as {
        ok?: boolean
        version?: string
        error?: string
      }
      if (json.ok) {
        setTestStatus({
          state: 'success',
          message: json.version
            ? `Connected — ${isPostgres ? 'Postgres' : 'ClickHouse'} ${json.version}`
            : 'Connected',
        })
        // ClickHouse-specific version telemetry; skip for Postgres.
        if (!isPostgres) {
          track('cluster_connected', {
            deploy_target: getDeployTarget(),
            ch_version: parseMajorMinor(json.version),
            ch_flavor: detectChFlavor(json.version),
          })
        }
      } else {
        setTestStatus({
          state: 'error',
          message: extractConnectionErrorMessage(json),
        })
      }
    } catch (err) {
      setTestStatus({
        state: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      })
    }
  }

  // Optional PeerDB monitoring link, folded into the saved envelope. Empty URL
  // (or the section not shown) ⇒ no PeerDB fields; `none` ⇒ URL only (open).
  const peerdbFields = (): Pick<
    ConnectionFormData,
    'peerdbApiUrl' | 'peerdbAuthScheme' | 'peerdbAuthSecret'
  > => {
    const url = peerdbApiUrl.trim()
    if (!allowPeerdb || !url) return {}
    if (peerdbAuthUi === 'none') return { peerdbApiUrl: url }
    return {
      peerdbApiUrl: url,
      peerdbAuthScheme: peerdbAuthUi,
      peerdbAuthSecret: peerdbSecret,
    }
  }

  const peerdbValid =
    !allowPeerdb || peerdbApiUrl.trim().length === 0
      ? true
      : isValidUrl(peerdbApiUrl.trim())

  const handleTestPeerdb = async () => {
    setPeerdbTest({ state: 'loading' })
    try {
      const response = await apiFetch('/api/v1/peerdb/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiUrl: peerdbApiUrl.trim(),
          ...(peerdbAuthUi === 'none'
            ? {}
            : { authScheme: peerdbAuthUi, secret: peerdbSecret }),
        }),
      })
      const json = (await response.json()) as {
        ok?: boolean
        version?: string
        error?: string
      }
      if (json.ok) {
        setPeerdbTest({
          state: 'success',
          message: json.version
            ? `Reached PeerDB ${json.version}`
            : 'Reached PeerDB',
        })
      } else {
        setPeerdbTest({
          state: 'error',
          message: json.error ?? 'PeerDB check failed',
        })
      }
    } catch (err) {
      setPeerdbTest({
        state: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      })
    }
  }

  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!isFormValid(form, isPostgres) || !peerdbValid || saving) return
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
              ...peerdbFields(),
            }
          : {
              name: form.name.trim(),
              host: form.host.trim(),
              user: form.user.trim(),
              password: form.password,
              engine: engineForPreset(preset),
              ...peerdbFields(),
            }
      )
    } finally {
      setSaving(false)
    }
  }

  const chFormValid = isFormValid(form, isPostgres)
  const valid = chFormValid && peerdbValid

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
      <div className="space-y-1.5">
        <Label htmlFor="conn-host" className="text-sm font-medium">
          {isPostgres ? 'Host' : 'Host URL'}
        </Label>
        {isPostgres ? (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                id="conn-host"
                placeholder={POSTGRES_HOST_PLACEHOLDER}
                value={form.host}
                onChange={handleChange('host')}
                className="pl-8"
                autoComplete="off"
              />
            </div>
            <Input
              id="conn-port"
              type="number"
              min={1}
              max={65535}
              className="w-24"
              placeholder={String(POSTGRES_DEFAULT_PORT)}
              value={form.port ?? ''}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  port:
                    e.target.value === '' ? undefined : Number(e.target.value),
                }))
              }
              aria-label="Postgres port"
            />
          </div>
        ) : (
          <div className="relative">
            <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              id="conn-host"
              placeholder={
                preset === 'clickhouse-cloud'
                  ? CLOUD_HOST_PLACEHOLDER
                  : SELF_HOSTED_HOST_PLACEHOLDER
              }
              value={form.host}
              onChange={handleChange('host')}
              onBlur={handleHostBlur}
              className="pl-8"
              autoComplete="off"
              type="url"
            />
          </div>
        )}
        {!isPostgres && form.host.length > 0 && !isValidUrl(form.host) && (
          <p className="text-xs text-destructive">
            Enter a valid HTTP or HTTPS URL
          </p>
        )}
        {preset === 'clickhouse-cloud' && (
          <p className="text-xs text-muted-foreground">
            Paste your Cloud service hostname; username is usually{' '}
            <code className="text-foreground">default</code>.
          </p>
        )}
        {isPostgres && (
          <p className="text-xs text-muted-foreground">
            Bare hostname or IP (no{' '}
            <code className="text-foreground">https://</code>
            ); the port is separate. Monitoring is read-only.
          </p>
        )}
      </div>

      {/* Postgres-only: database + SSL mode. */}
      {isPostgres && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="conn-database" className="text-sm font-medium">
              Database
            </Label>
            <Input
              id="conn-database"
              placeholder="postgres"
              value={form.database ?? ''}
              onChange={handleChange('database')}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conn-sslmode" className="text-sm font-medium">
              SSL mode
            </Label>
            <Select
              value={form.sslmode ?? 'require'}
              onValueChange={(v) =>
                setForm((prev) => ({ ...prev, sslmode: v ?? 'require' }))
              }
            >
              <SelectTrigger id="conn-sslmode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POSTGRES_SSLMODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {mode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
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
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="save-to-server" className="text-sm font-medium">
                Save to server (synced)
              </Label>
              <p className="text-xs text-muted-foreground">
                {storageMode === 'database'
                  ? 'Stored encrypted on the server. Syncs across devices when signed in.'
                  : 'Stored encrypted in this browser only.'}
              </p>
            </div>
            <Switch
              id="save-to-server"
              checked={storageMode === 'database'}
              disabled={!dbStorageEnabled}
              onCheckedChange={(checked) =>
                onStorageModeChange(checked ? 'database' : 'browser')
              }
            />
          </div>
          {!dbStorageEnabled && (
            <p className="text-xs text-muted-foreground">
              {dbStorageRequiresSignIn ? (
                'Sign in to save connections to the server (synced per account) — then select a plan or join an organization for more access.'
              ) : (
                <>
                  Server storage is disabled on this deployment.{' '}
                  <a
                    href={docsSiteUrl('features/user-connections')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Enable user connections
                  </a>{' '}
                  to save credentials to your account and access your
                  team&apos;s clusters.
                </>
              )}
            </p>
          )}
        </div>
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
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md py-1 text-sm font-medium text-foreground">
            <span>Advanced</span>
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform ${
                advancedOpen ? 'rotate-180' : ''
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2">
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-start gap-2">
                <Waypoints className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    PeerDB monitoring (optional)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Link this connection&apos;s CDC replication — the PeerDB
                    flow-api endpoint. Monitoring is view-only.
                  </p>
                </div>
              </div>

              {/* API URL */}
              <div className="space-y-1.5">
                <Label htmlFor="peerdb-url" className="text-sm font-medium">
                  API URL
                </Label>
                <Input
                  id="peerdb-url"
                  placeholder="https://peerdb.example.com/api"
                  value={peerdbApiUrl}
                  onChange={(e) => {
                    setPeerdbApiUrl(e.target.value)
                    if (peerdbTest.state !== 'idle')
                      setPeerdbTest({ state: 'idle' })
                  }}
                  autoComplete="off"
                  type="url"
                />
                {peerdbApiUrl.trim().length > 0 &&
                  !isValidUrl(peerdbApiUrl.trim()) && (
                    <p className="text-xs text-destructive">
                      Enter a valid HTTP or HTTPS URL
                    </p>
                  )}
              </div>

              {/* Auth scheme + secret */}
              <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="peerdb-auth" className="text-sm font-medium">
                    Auth
                  </Label>
                  <Select
                    value={peerdbAuthUi}
                    onValueChange={(v) => {
                      setPeerdbAuthUi(v as PeerdbAuthUi)
                      if (peerdbTest.state !== 'idle')
                        setPeerdbTest({ state: 'idle' })
                    }}
                  >
                    <SelectTrigger id="peerdb-auth">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="basic">Password</SelectItem>
                      <SelectItem value="bearer">API token</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {peerdbAuthUi !== 'none' && (
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="peerdb-secret"
                      className="text-sm font-medium"
                    >
                      {peerdbAuthUi === 'bearer' ? 'API token' : 'Password'}
                    </Label>
                    <Input
                      id="peerdb-secret"
                      type="password"
                      placeholder="••••••••"
                      value={peerdbSecret}
                      onChange={(e) => {
                        setPeerdbSecret(e.target.value)
                        if (peerdbTest.state !== 'idle')
                          setPeerdbTest({ state: 'idle' })
                      }}
                      autoComplete="off"
                    />
                  </div>
                )}
              </div>

              {/* Test PeerDB */}
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestPeerdb}
                  disabled={
                    peerdbApiUrl.trim().length === 0 ||
                    !isValidUrl(peerdbApiUrl.trim()) ||
                    peerdbTest.state === 'loading'
                  }
                >
                  {peerdbTest.state === 'loading' ? (
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  ) : null}
                  Test PeerDB
                </Button>
                {peerdbTest.state === 'success' && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <Check className="size-3.5" />
                    {peerdbTest.message}
                  </span>
                )}
                {peerdbTest.state === 'error' && (
                  <span className="text-xs text-destructive">
                    {peerdbTest.message}
                  </span>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Test Connection */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={!chFormValid || testStatus.state === 'loading'}
        >
          {testStatus.state === 'loading' ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : null}
          Test Connection
        </Button>

        {testStatus.state === 'success' && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="size-3.5" />
            {testStatus.message}
          </span>
        )}
      </div>

      {/* Rich, actionable error panel — classifies the raw ClickHouse / network
          error into a cause + fix + docs link for the specific failure kind. */}
      {testStatus.state === 'error' && (
        <ConnectionErrorPanel
          message={testStatus.message}
          cloudPreset={preset === 'clickhouse-cloud'}
        />
      )}

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

/**
 * Renders a classified connection error: a clear title, why it likely happened,
 * the concrete fix, the raw technical detail, and a docs link for that exact
 * failure kind (host not allowed, auth failed, permissions, DNS, TLS, …).
 */
function ConnectionErrorPanel({
  message,
  cloudPreset = false,
}: {
  message?: string
  /** Whether the ClickHouse Cloud preset was active for this test attempt. */
  cloudPreset?: boolean
}) {
  const e = classifyConnectionError(message)
  // Cloud-specific nudge on top of the generic classification — reachability
  // failures on the Cloud preset are almost always a TLS/port mismatch (the
  // 8443 HTTPS interface, never plain HTTP). Additive only: the shared
  // classifier in `lib/connection-errors.ts` (also used by self-host) is
  // untouched.
  const showCloudTlsHint =
    cloudPreset &&
    (e.kind === 'tls_error' ||
      e.kind === 'connection_refused' ||
      e.kind === 'invalid_url' ||
      e.kind === 'timeout')
  return (
    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <div className="flex justify-center pb-1">
        <BrokenWireIllustration kind={e.kind} />
      </div>
      <p className="text-sm font-medium text-destructive">{e.title}</p>
      <p className="text-xs text-muted-foreground">{e.explanation}</p>
      <p className="text-xs">
        <span className="font-medium">What to do: </span>
        <span className="text-muted-foreground">{e.fix}</span>
      </p>
      {showCloudTlsHint && (
        <p className="text-xs">
          <span className="font-medium">ClickHouse Cloud: </span>
          <span className="text-muted-foreground">
            requires TLS on port 8443 — confirm the URL starts with{' '}
            <code className="text-foreground">https://</code> and ends with{' '}
            <code className="text-foreground">:8443</code>.
          </span>
        </p>
      )}
      {e.kind !== 'unknown' && e.raw && (
        <pre className="overflow-x-auto rounded bg-muted/60 p-2 text-[11px] text-muted-foreground">
          <code>{e.raw}</code>
        </pre>
      )}
      <a
        href={docsSiteUrl(e.docsSlug)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
      >
        View troubleshooting docs
        <ArrowUpRight className="size-3" />
      </a>
    </div>
  )
}
