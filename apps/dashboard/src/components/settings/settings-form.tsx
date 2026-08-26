import {
  Binary,
  BlocksIcon,
  Clock,
  EyeOff,
  Globe,
  Hash,
  LayoutGrid,
  Palette,
  RotateCcw,
  Rows3,
  Settings,
} from 'lucide-react'

import type { SettingsTab } from '@/lib/settings-tab'
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
import { TimezoneCombobox } from './timezone-combobox'
import { WorkspacePresetPicker } from './workspace-preset-picker'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TIME_RANGE_PRESETS } from '@/lib/context/time-range-context'
import {
  formatReadableQuantity,
  formatReadableSize,
} from '@/lib/format-readable'
import { useActiveHostEngine } from '@/lib/hooks/use-active-pg-connection'
import { apiFetch } from '@/lib/swr/api-fetch'
import { cn } from '@/lib/utils'

interface SettingsFormProps {
  settings: UserSettings
  onUpdate: (updates: Partial<UserSettings>) => void
  onClose: () => void
  /** Opens this pane. Defaults to General. */
  initialTab?: SettingsTab
}

const themeOptions = [
  { value: 'light', label: 'Light', description: 'Light mode' },
  { value: 'dark', label: 'Dark', description: 'Dark mode' },
  { value: 'system', label: 'System', description: 'Sync with system' },
] as const

const chartPaletteMeta: {
  value: ChartPalette
  label: string
  hint: string
}[] = [
  { value: 'default', label: 'Default', hint: 'Brand orange ramp' },
  {
    value: 'colorblind-safe',
    label: 'Colorblind',
    hint: 'Okabe–Ito distinct hues',
  },
  { value: 'monochrome', label: 'Mono', hint: 'Single-hue amber ramp' },
]

const densityOptions: readonly SegmentedOption<TableDensity>[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]

/** Sample byte value (1.5 GiB) used for the live units preview. */
const BYTE_PREVIEW_SAMPLE = 1.5 * 1024 ** 3
/** Sample quantity (1,200,000) used for the live numbers preview. */
const NUMBER_PREVIEW_SAMPLE = 1_200_000

/**
 * Representative swatches for each chart palette so the user can see the
 * difference at a glance. Values mirror the `--chart-1..5` tokens defined in
 * `styles.css` (default orange ramp, Okabe-Ito, single-hue ramp).
 */
const PALETTE_SWATCHES: Record<ChartPalette, string[]> = {
  default: ['#f5a524', '#fb923c', '#f97316', '#ea580c', '#c2410c'],
  'colorblind-safe': ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2'],
  monochrome: ['#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f'],
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

function WindowPane({ dark }: { dark?: boolean }) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col px-1.5 pt-1.5',
        dark ? 'bg-zinc-900' : 'bg-zinc-100'
      )}
    >
      <div className="mb-1.5 flex gap-0.5">
        <span
          className={cn(
            'size-1 rounded-full',
            dark ? 'bg-zinc-600' : 'bg-zinc-300'
          )}
        />
        <span
          className={cn(
            'size-1 rounded-full',
            dark ? 'bg-zinc-600' : 'bg-zinc-300'
          )}
        />
        <span
          className={cn(
            'size-1 rounded-full',
            dark ? 'bg-zinc-600' : 'bg-zinc-300'
          )}
        />
      </div>
      <div
        className={cn(
          'mb-0.5 h-1 w-3/4 rounded-sm',
          dark ? 'bg-zinc-700' : 'bg-zinc-300'
        )}
      />
      <div
        className={cn(
          'mb-0.5 h-1 w-full rounded-sm',
          dark ? 'bg-zinc-700' : 'bg-zinc-300'
        )}
      />
      <div
        className={cn(
          'h-1 w-2/3 rounded-sm',
          dark ? 'bg-zinc-700' : 'bg-zinc-300'
        )}
      />
    </div>
  )
}

function ThemePreview({ mode }: { mode: 'light' | 'dark' | 'system' }) {
  return (
    <div className="flex h-[52px] w-[68px] overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/10">
      {mode === 'light' && <WindowPane />}
      {mode === 'dark' && <WindowPane dark />}
      {mode === 'system' && (
        <>
          <WindowPane dark />
          <WindowPane />
        </>
      )}
    </div>
  )
}

function ThemePicker({
  value,
  onChange,
}: {
  value: UserSettings['theme']
  onChange: (value: UserSettings['theme']) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-start gap-3"
    >
      {themeOptions.map((option) => {
        const isSelected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            className="flex flex-col items-center gap-1.5 focus-visible:outline-none"
            aria-label={`Select ${option.description}`}
          >
            <span
              className={cn(
                'rounded-[14px] p-0.5 ring-2 transition-shadow',
                isSelected
                  ? 'ring-foreground'
                  : 'ring-transparent hover:ring-border'
              )}
            >
              <ThemePreview mode={option.value} />
            </span>
            <span
              className={cn(
                'text-xs',
                isSelected ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function SettingsRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  )
}

const PALETTE_BAR_HEIGHTS = [38, 72, 48, 88, 60]

function PalettePicker({
  value,
  onChange,
}: {
  value: ChartPalette
  onChange: (value: ChartPalette) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Chart palette"
      className="grid gap-2 sm:grid-cols-3"
    >
      {chartPaletteMeta.map((option) => {
        const isSelected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex flex-col gap-2 rounded-lg border-2 p-2.5 text-left transition-[opacity,border-color,background-color,box-shadow] hover:opacity-80',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              isSelected
                ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                : 'border-muted bg-muted/20'
            )}
          >
            <div className="flex h-10 items-end gap-0.5">
              {PALETTE_SWATCHES[option.value].map((color, i) => (
                <span
                  key={`${option.value}-${i}`}
                  className="min-w-0 flex-1 rounded-sm ring-1 ring-black/10 dark:ring-white/10"
                  style={{
                    backgroundColor: color,
                    height: `${PALETTE_BAR_HEIGHTS[i]}%`,
                  }}
                />
              ))}
            </div>
            <div className="space-y-0.5">
              <span className="block text-xs font-medium">{option.label}</span>
              <span className="block text-[11px] text-muted-foreground">
                {option.hint}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

const COMING_SOON_INTEGRATIONS = [
  { name: 'Slack', description: 'Post health alerts to a Slack channel' },
  { name: 'Telegram', description: 'Send alerts to a Telegram chat' },
  { name: 'PagerDuty', description: 'Page on-call when a check fails' },
  { name: 'Email', description: 'Email a digest or incident notice' },
  { name: 'Discord', description: 'Post alerts to a Discord webhook' },
] as const

/**
 * Mini illustration of table row density — taller, looser rows for
 * "comfortable", tighter rows for "compact".
 */
function DensityPreview({ density }: { density: TableDensity }) {
  const isCompact = density === 'compact'
  return (
    <div
      className={cn(
        'flex w-full flex-col rounded-md border border-border bg-muted/30 p-2',
        isCompact ? 'gap-1' : 'gap-2.5'
      )}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={cn(
            'rounded bg-foreground/10',
            isCompact ? 'h-2' : 'h-3.5'
          )}
        />
      ))}
    </div>
  )
}

/**
 * Mini sidebar demo for unavailable-page behaviour.
 * Dim keeps Backups grayed out; Hide drops that row so only live pages remain.
 */
function MenuPreview({ mode }: { mode: 'dim' | 'hide' }) {
  return (
    <div className="flex h-[72px] w-[88px] flex-col gap-1 overflow-hidden rounded-lg bg-zinc-100 p-1.5 ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10">
      <div className="flex items-center gap-1 text-[10px] leading-none">
        <LayoutGrid className="size-3 shrink-0" />
        <span>Queries</span>
      </div>
      {mode === 'dim' ? (
        <div className="flex items-center gap-1 text-[10px] leading-none text-muted-foreground/40">
          <BlocksIcon className="size-3 shrink-0" />
          <span>Backups</span>
        </div>
      ) : (
        <div
          className="h-3 rounded border border-dashed border-muted-foreground/25"
          aria-hidden="true"
        />
      )}
      <div className="flex items-center gap-1 text-[10px] leading-none">
        <Rows3 className="size-3 shrink-0" />
        <span>Tables</span>
      </div>
    </div>
  )
}

const unavailablePageOptions = [
  {
    value: true,
    mode: 'dim' as const,
    label: 'Dim',
    description: 'Keep unavailable pages grayed out in the menu',
  },
  {
    value: false,
    mode: 'hide' as const,
    label: 'Hide',
    description: 'Remove unavailable pages from the menu',
  },
]

function UnavailablePagesPicker({
  value,
  onChange,
}: {
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Unavailable pages"
      className="flex items-start gap-3"
    >
      {unavailablePageOptions.map((option) => {
        const isSelected = value === option.value
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            className="flex flex-col items-center gap-1.5 focus-visible:outline-none"
            aria-label={option.description}
          >
            <span
              className={cn(
                'rounded-[14px] p-0.5 ring-2 transition-shadow',
                isSelected
                  ? 'ring-foreground'
                  : 'ring-transparent hover:ring-border'
              )}
            >
              <MenuPreview mode={option.mode} />
            </span>
            <span
              className={cn(
                'text-xs',
                isSelected ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function SettingsForm({
  settings,
  onUpdate,
  onClose,
  initialTab = 'general',
}: SettingsFormProps) {
  const { setTheme } = useTheme()
  const engine = useActiveHostEngine()
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
  const binaryExample = formatReadableSize(BYTE_PREVIEW_SAMPLE, 1, 'binary')
  const decimalExample = formatReadableSize(BYTE_PREVIEW_SAMPLE, 1, 'decimal')
  const abbreviatedExample = formatReadableQuantity(
    NUMBER_PREVIEW_SAMPLE,
    'short'
  )
  const fullExample = formatReadableQuantity(NUMBER_PREVIEW_SAMPLE, 'long')

  const byteUnitOptions: readonly SegmentedOption<ByteUnit>[] = [
    { value: 'binary', label: 'Binary', description: binaryExample },
    { value: 'decimal', label: 'Decimal', description: decimalExample },
  ]
  const numberFormatOptions: readonly SegmentedOption<NumberFormat>[] = [
    {
      value: 'abbreviated',
      label: 'Abbreviated',
      description: abbreviatedExample,
    },
    { value: 'full', label: 'Full', description: fullExample },
  ]

  const navGroups: {
    label: string
    items: { value: string; label: string; icon: typeof Clock }[]
  }[] = [
    {
      label: 'Preferences',
      items: [
        { value: 'general', label: 'General', icon: Clock },
        { value: 'appearance', label: 'Appearance', icon: Palette },
      ],
    },
    {
      label: 'Display',
      items: [
        { value: 'units', label: 'Units', icon: Binary },
        { value: 'layout', label: 'Layout', icon: Rows3 },
      ],
    },
    {
      label: 'Workspace',
      items: [
        { value: 'navigation', label: 'Navigation', icon: EyeOff },
        { value: 'integrations', label: 'Integrations', icon: Globe },
      ],
    },
  ]

  const [activeTab, setActiveTab] = useState(initialTab)
  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])
  const activeLabel =
    navGroups
      .flatMap((group) => group.items)
      .find((item) => item.value === activeTab)?.label ?? 'Settings'

  return (
    <div className="flex min-h-0 flex-1">
      <Tabs
        value={activeTab}
        onValueChange={(value) => value && setActiveTab(value)}
        orientation="vertical"
        className="flex min-h-0 flex-1 gap-0"
      >
        <aside className="flex w-44 shrink-0 flex-col border-r border-border px-3 py-4 sm:w-48">
          <div className="mb-4 px-2.5">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Settings
                className="size-3.5 text-muted-foreground"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              Settings
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Local to this browser
            </p>
          </div>
          <TabsList
            variant="line"
            className="h-auto w-full flex-col items-stretch gap-0.5 overflow-y-auto p-0"
          >
            {navGroups.map((group) => (
              <div key={group.label} className="pb-2">
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <TabsTrigger
                      key={item.value}
                      value={item.value}
                      className={cn(
                        'h-8 justify-start gap-2 rounded-lg px-2.5 font-normal shadow-none after:hidden',
                        'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                        'data-active:bg-muted data-active:text-foreground data-active:shadow-none',
                        'dark:data-active:bg-muted dark:data-active:text-foreground'
                      )}
                    >
                      <Icon
                        className="size-3.5"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                      {item.label}
                    </TabsTrigger>
                  )
                })}
              </div>
            ))}
          </TabsList>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center px-5 pt-4 pr-12">
            <h2 className="text-sm font-semibold">{activeLabel}</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {/* General */}
            <TabsContent value="general" className="space-y-4 px-1 pb-2">
              <Field
                label="Timezone"
                icon={Clock}
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
                <TimezoneCombobox
                  value={settings.timezone}
                  onChange={(timezone) => onUpdate({ timezone })}
                  defaultTimezone={defaultTimezone}
                />
              </Field>
            </TabsContent>

            {/* Appearance */}
            <TabsContent value="appearance" className="space-y-5 px-1 pb-2">
              <SettingsRow label="Theme">
                <ThemePicker
                  value={settings.theme}
                  onChange={handleThemeChange}
                />
              </SettingsRow>

              <Field
                label="Chart palette"
                icon={Palette}
                description="Colour scheme for chart series. Applied to every chart on this browser."
              >
                <PalettePicker
                  value={settings.chartPalette}
                  onChange={(value) => onUpdate({ chartPalette: value })}
                />
              </Field>
            </TabsContent>

            {/* Units */}
            <TabsContent value="units" className="space-y-5 px-1 pb-2">
              <Field
                label="Byte sizes"
                icon={Binary}
                description="Binary is 1024-based (KiB, MiB, GiB). Decimal is 1000-based (KB, MB, GB)."
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
                description="Abbreviated uses compact suffixes. Full shows grouped digits."
              >
                <SegmentedControl
                  ariaLabel="Large numbers"
                  value={settings.numberFormat}
                  onChange={(value) => onUpdate({ numberFormat: value })}
                  options={numberFormatOptions}
                />
              </Field>
            </TabsContent>

            {/* Layout */}
            <TabsContent value="layout" className="space-y-5 px-1 pb-2">
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
                <DensityPreview density={settings.tableDensity} />
              </Field>

              <Field
                label="Default time range"
                icon={Clock}
                description="Initial time range for time-series pages. Explicit clicks and shared ?range= links still take priority."
              >
                <Select
                  value={settings.defaultTimeRange}
                  onValueChange={(value) =>
                    value &&
                    onUpdate({ defaultTimeRange: value as DefaultTimeRange })
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
            </TabsContent>

            {/* Navigation */}
            <TabsContent value="navigation" className="space-y-4 px-1 pb-2">
              <Field
                label="Workspace"
                icon={LayoutGrid}
                description="Hide pages from the sidebar and command palette. Full restores every page. Hidden pages stay reachable by URL."
              >
                <WorkspacePresetPicker
                  preset={settings.workspacePreset}
                  hiddenMenuHrefs={settings.hiddenMenuHrefs}
                  engine={engine}
                  onChange={(next) => onUpdate(next)}
                />
              </Field>

              <div className="space-y-2">
                <SettingsRow label="Unavailable pages">
                  <UnavailablePagesPicker
                    value={settings.dimUnavailablePages}
                    onChange={(dimUnavailablePages) =>
                      onUpdate({ dimUnavailablePages })
                    }
                  />
                </SettingsRow>
                <p className="text-xs text-muted-foreground">
                  {settings.dimUnavailablePages
                    ? 'Pages whose system table is missing stay in the menu, grayed out (example: Backups).'
                    : 'Pages whose system table is missing are removed from the menu entirely.'}
                </p>
              </div>
            </TabsContent>

            {/* Integrations */}
            <TabsContent value="integrations" className="space-y-4 px-1 pb-2">
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

              <div className="space-y-2">
                <p className="text-sm font-medium">More channels</p>
                <p className="text-xs text-muted-foreground">
                  These destinations are not wired yet. They stay visible so you
                  can see what is coming.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {COMING_SOON_INTEGRATIONS.map((item) => (
                    <div
                      key={item.name}
                      aria-disabled="true"
                      className="flex flex-col gap-1 rounded-lg border border-dashed border-border bg-muted/10 px-3 py-2.5 opacity-60"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{item.name}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          Soon
                        </Badge>
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {item.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </div>
          <div className="flex justify-end border-t border-border px-5 py-3">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </Tabs>
    </div>
  )
}
