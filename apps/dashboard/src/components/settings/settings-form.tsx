import {
  Binary,
  Globe,
  Hash,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Rows3,
  Sun,
} from 'lucide-react'

import type {
  ByteUnit,
  ChartPalette,
  DefaultTimeRange,
  NumberFormat,
  TableDensity,
  UserSettings,
} from '@/lib/types/user-settings'
import type { SegmentedOption } from './segmented-control'

import { SegmentedControl } from './segmented-control'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { TIMEZONE_GROUPS } from '@/lib/constants/timezones'
import { TIME_RANGE_PRESETS } from '@/lib/context/time-range-context'
import {
  formatReadableQuantity,
  formatReadableSize,
} from '@/lib/format-readable'
import { apiFetch } from '@/lib/swr/api-fetch'
import { cn } from '@/lib/utils'

interface SettingsFormProps {
  settings: UserSettings
  onUpdate: (updates: Partial<UserSettings>) => void
  onClose: () => void
}

const themeOptions = [
  { value: 'light', label: 'Light', icon: Sun, description: 'Light mode' },
  { value: 'dark', label: 'Dark', icon: Moon, description: 'Dark mode' },
  {
    value: 'system',
    label: 'System',
    icon: Monitor,
    description: 'Sync with system',
  },
] as const

const byteUnitOptions: readonly SegmentedOption<ByteUnit>[] = [
  { value: 'binary', label: 'Binary' },
  { value: 'decimal', label: 'Decimal' },
]

const numberFormatOptions: readonly SegmentedOption<NumberFormat>[] = [
  { value: 'abbreviated', label: 'Abbreviated' },
  { value: 'full', label: 'Full' },
]

const chartPaletteOptions: readonly SegmentedOption<ChartPalette>[] = [
  { value: 'default', label: 'Default' },
  { value: 'colorblind-safe', label: 'Colorblind' },
  { value: 'monochrome', label: 'Mono' },
]

const densityOptions: readonly SegmentedOption<TableDensity>[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]

/** Sample byte value (1.5 GiB) used for the live units preview. */
const BYTE_PREVIEW_SAMPLE = 1.5 * 1024 ** 3
/** Sample quantity (1,200,000) used for the live numbers preview. */
const NUMBER_PREVIEW_SAMPLE = 1_200_000

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  )
}

function Field({
  label,
  icon: Icon,
  description,
  children,
}: {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-sm font-medium">
        {Icon && <Icon className="size-3.5" aria-hidden="true" />}
        {label}
      </Label>
      {children}
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  )
}

export function SettingsForm({
  settings,
  onUpdate,
  onClose,
}: SettingsFormProps) {
  const { setTheme } = useTheme()
  const [defaultTimezone, setDefaultTimezone] = useState<string | null>(null)
  const [isLoadingDefault, setIsLoadingDefault] = useState(true)

  // Fetch default timezone from API
  useEffect(() => {
    async function fetchDefaultTimezone() {
      try {
        const response = await apiFetch('/api/v1/dashboard/settings?hostId=0')
        if (response.ok) {
          const data = (await response.json()) as {
            success?: boolean
            data?: { params?: { timezone?: string } }
          }
          if (data.success && data.data?.params?.timezone) {
            setDefaultTimezone(data.data.params.timezone)
          }
        }
      } catch (error) {
        console.warn('Failed to fetch default timezone:', error)
      } finally {
        setIsLoadingDefault(false)
      }
    }

    fetchDefaultTimezone()
  }, [])

  const handleThemeChange = (value: UserSettings['theme']) => {
    onUpdate({ theme: value })
    setTheme(value)
  }

  const handleResetTimezone = () => {
    if (defaultTimezone) {
      onUpdate({ timezone: defaultTimezone })
    }
  }

  const isUsingDefault =
    defaultTimezone && settings.timezone === defaultTimezone

  // Live previews reflect the selected unit explicitly (independent of the
  // global format snapshot), so the example updates as the user toggles.
  const bytePreview = `${formatReadableSize(
    BYTE_PREVIEW_SAMPLE,
    1,
    'binary'
  )} ↔ ${formatReadableSize(BYTE_PREVIEW_SAMPLE, 1, 'decimal')}`
  const numberPreview = `${formatReadableQuantity(
    NUMBER_PREVIEW_SAMPLE,
    'short'
  )} ↔ ${formatReadableQuantity(NUMBER_PREVIEW_SAMPLE, 'long')}`

  return (
    <div className="max-h-[70vh] space-y-6 overflow-y-auto py-4 pr-1">
      {/* General */}
      <section className="space-y-3">
        <SectionHeader>General</SectionHeader>
        <Field
          label="Timezone"
          description="All datetimes will be displayed in your selected timezone"
        >
          {!isLoadingDefault && defaultTimezone && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={handleResetTimezone}
                disabled={!!isUsingDefault}
              >
                <RotateCcw className="mr-1 size-3" />
                Reset to default
              </Button>
            </div>
          )}
          <Select
            value={settings.timezone}
            onValueChange={(value) =>
              onUpdate({ timezone: value ?? undefined })
            }
          >
            <SelectTrigger id="timezone" className="h-9">
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONE_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel className="text-xs">{group.label}</SelectLabel>
                  {group.timezones.map((tz) => (
                    <SelectItem
                      key={tz.value}
                      value={tz.value}
                      className="text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>{tz.label}</span>
                        {defaultTimezone === tz.value && (
                          <span className="text-[10px] text-muted-foreground">
                            (default)
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </section>

      <Separator />

      {/* Appearance */}
      <section className="space-y-4">
        <SectionHeader>Appearance</SectionHeader>

        <Field label="Theme">
          <div className="grid grid-cols-3 gap-2">
            {themeOptions.map((option) => {
              const Icon = option.icon
              const isSelected = settings.theme === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleThemeChange(option.value)}
                  className={cn(
                    'relative flex flex-col items-center justify-center rounded-lg border-2 p-3 transition-[opacity,border-color,background-color,box-shadow] hover:opacity-80',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                    isSelected
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-muted bg-muted/20'
                  )}
                  aria-pressed={isSelected}
                  aria-label={`Select ${option.description}`}
                >
                  <Icon className="mb-2 size-5" aria-hidden="true" />
                  <span className="text-xs font-medium">{option.label}</span>
                </button>
              )
            })}
          </div>
        </Field>

        <Field
          label="Chart palette"
          icon={Palette}
          description="Color scheme for chart series. Colorblind uses the Okabe-Ito palette; Mono is a single-hue ramp."
        >
          <SegmentedControl
            ariaLabel="Chart palette"
            value={settings.chartPalette}
            onChange={(value) => onUpdate({ chartPalette: value })}
            options={chartPaletteOptions}
          />
        </Field>
      </section>

      <Separator />

      {/* Units */}
      <section className="space-y-4">
        <SectionHeader>Units</SectionHeader>

        <Field
          label="Byte sizes"
          icon={Binary}
          description={`Binary uses 1024-based KiB/MiB; Decimal uses 1000-based KB/MB. e.g. ${bytePreview}`}
        >
          <SegmentedControl
            ariaLabel="Byte sizes"
            value={settings.byteUnit}
            onChange={(value) => onUpdate({ byteUnit: value })}
            options={byteUnitOptions}
          />
        </Field>

        <Field
          label="Large numbers"
          icon={Hash}
          description={`Abbreviated shows compact suffixes; Full shows grouped digits. e.g. ${numberPreview}`}
        >
          <SegmentedControl
            ariaLabel="Large numbers"
            value={settings.numberFormat}
            onChange={(value) => onUpdate({ numberFormat: value })}
            options={numberFormatOptions}
          />
        </Field>
      </section>

      <Separator />

      {/* Layout */}
      <section className="space-y-4">
        <SectionHeader>Layout</SectionHeader>

        <Field
          label="Table density"
          icon={Rows3}
          description="Row height for data tables. Compact fits more rows on screen."
        >
          <SegmentedControl
            ariaLabel="Table density"
            value={settings.tableDensity}
            onChange={(value) => onUpdate({ tableDensity: value })}
            options={densityOptions}
          />
        </Field>

        <Field
          label="Default time range"
          description="Initial time range for time-series pages. Explicit clicks and shared ?range= links still take priority."
        >
          <Select
            value={settings.defaultTimeRange}
            onValueChange={(value) =>
              value && onUpdate({ defaultTimeRange: value as DefaultTimeRange })
            }
          >
            <SelectTrigger id="default-time-range" className="h-9">
              <SelectValue placeholder="Select default range" />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGE_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </section>

      <Separator />

      {/* Integrations */}
      <section className="space-y-3">
        <SectionHeader>Integrations</SectionHeader>
        <Field
          label="MCP Server"
          icon={Globe}
          description="Connect AI assistants to your ClickHouse cluster via the Model Context Protocol."
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start text-xs"
            onClick={() => window.open('/mcp', '_blank')}
          >
            <Globe className="mr-2 size-3" />
            View MCP Server Details
          </Button>
        </Field>
      </section>

      <div className="flex justify-end pt-4">
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  )
}
