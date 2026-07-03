import { ArrowUpRight, Check, Eye, EyeOff, Globe, Loader2 } from 'lucide-react'

import type { BrowserConnection } from '@/lib/types/browser-connection'
import type { HostStorageMode } from '@/lib/types/host-storage'
import type { ConnectionPreset } from './connection-presets'

import {
  applyCloudHostDefaults,
  CLOUD_HOST_PLACEHOLDER,
  SELF_HOSTED_HOST_PLACEHOLDER,
} from './connection-presets'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  'name' | 'host' | 'user' | 'password'
>

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
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isFormValid(data: ConnectionFormData): boolean {
  return (
    data.name.trim().length > 0 &&
    isValidUrl(data.host.trim()) &&
    data.user.trim().length > 0
  )
}

export function ConnectionForm({
  onSave,
  initialValues,
  onCancel,
  storageMode = 'browser',
  onStorageModeChange,
  dbStorageEnabled = false,
  dbStorageRequiresSignIn = false,
}: ConnectionFormProps) {
  const [form, setForm] = useState<ConnectionFormData>({
    name: initialValues?.name ?? '',
    host: initialValues?.host ?? '',
    user: initialValues?.user ?? '',
    password: initialValues?.password ?? '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>({ state: 'idle' })
  const [preset, setPreset] = useState<ConnectionPreset>('self-hosted')

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
    // Only fill a still-empty username — never clobber an existing value
    // (e.g. while editing an existing connection via ConnectionManagerDialog).
    if (next === 'clickhouse-cloud') {
      setForm((prev) =>
        prev.user.trim() ? prev : { ...prev, user: 'default' }
      )
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

  const handleTest = async () => {
    setTestStatus({ state: 'loading' })
    try {
      const response = await apiFetch('/api/v1/browser-connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: form.host.trim(),
          user: form.user.trim(),
          password: form.password,
        }),
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
            ? `Connected — ClickHouse ${json.version}`
            : 'Connected',
        })
        track('cluster_connected', {
          deploy_target: getDeployTarget(),
          ch_version: parseMajorMinor(json.version),
          ch_flavor: detectChFlavor(json.version),
        })
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

  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!isFormValid(form) || saving) return
    setSaving(true)
    try {
      await onSave({
        name: form.name.trim(),
        host: form.host.trim(),
        user: form.user.trim(),
        password: form.password,
      })
    } finally {
      setSaving(false)
    }
  }

  const valid = isFormValid(form)

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
          </TabsList>
        </Tabs>
      </div>

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

      {/* Host URL */}
      <div className="space-y-1.5">
        <Label htmlFor="conn-host" className="text-sm font-medium">
          Host URL
        </Label>
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
        {form.host.length > 0 && !isValidUrl(form.host) && (
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
      </div>

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

      {/* Test Connection */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={!valid || testStatus.state === 'loading'}
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
