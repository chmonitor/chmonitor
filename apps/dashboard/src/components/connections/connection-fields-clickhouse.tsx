import { Globe } from 'lucide-react'

import type { ConnectionFormData } from './connection-form-schema'
import type { ConnectionPreset } from './connection-presets'

import { isValidUrl } from './connection-form-schema'
import {
  CLOUD_HOST_PLACEHOLDER,
  SELF_HOSTED_HOST_PLACEHOLDER,
} from './connection-presets'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * The ClickHouse (self-hosted / Cloud) "Host URL" field — a full HTTP(S) URL,
 * unlike the bare hostname + port Postgres uses. Extracted verbatim from
 * `ConnectionForm`; behavior and layout are unchanged.
 */
export function ConnectionFieldsClickHouse({
  form,
  preset,
  onHostChange,
  onHostBlur,
}: {
  form: ConnectionFormData
  preset: ConnectionPreset
  onHostChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onHostBlur: () => void
}) {
  return (
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
          onChange={onHostChange}
          onBlur={onHostBlur}
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
  )
}
