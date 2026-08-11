import { Globe } from 'lucide-react'

import type { Dispatch, SetStateAction } from 'react'
import type { ConnectionFormData } from './connection-form-schema'

import { POSTGRES_SSLMODES } from './connection-form-schema'
import {
  POSTGRES_DEFAULT_PORT,
  POSTGRES_HOST_PLACEHOLDER,
} from './connection-presets'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * The Postgres field group — a bare hostname + port (not a URL, unlike
 * ClickHouse) plus the Postgres-only database and SSL-mode fields. Extracted
 * verbatim from `ConnectionForm`; behavior and layout are unchanged.
 */
export function ConnectionFieldsPostgres({
  form,
  setForm,
  onHostChange,
  onDatabaseChange,
}: {
  form: ConnectionFormData
  setForm: Dispatch<SetStateAction<ConnectionFormData>>
  onHostChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDatabaseChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="conn-host" className="text-sm font-medium">
          Host
        </Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              id="conn-host"
              placeholder={POSTGRES_HOST_PLACEHOLDER}
              value={form.host}
              onChange={onHostChange}
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
        <p className="text-xs text-muted-foreground">
          Bare hostname or IP (no{' '}
          <code className="text-foreground">https://</code>
          ); the port is separate. Monitoring is read-only.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="conn-database" className="text-sm font-medium">
            Database
          </Label>
          <Input
            id="conn-database"
            placeholder="postgres"
            value={form.database ?? ''}
            onChange={onDatabaseChange}
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
    </>
  )
}
