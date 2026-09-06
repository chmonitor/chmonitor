import { Settings } from 'lucide-react'

import type { SettingsTab } from '@/lib/settings-tab'
import type { UserSettings } from '@/lib/types/user-settings'

import { navGroups } from './nav-groups'
import { AppearanceTab } from './tabs/appearance-tab'
import { GeneralTab } from './tabs/general-tab'
import { IntegrationsTab } from './tabs/integrations-tab'
import { LayoutTab } from './tabs/layout-tab'
import { NavigationTab } from './tabs/navigation-tab'
import { UnitsTab } from './tabs/units-tab'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { apiFetch } from '@/lib/swr/api-fetch'
import { cn } from '@/lib/utils'

interface SettingsFormProps {
  settings: UserSettings
  onUpdate: (updates: Partial<UserSettings>) => void
  onClose: () => void
  /** Opens this pane. Defaults to General. */
  initialTab?: SettingsTab
  /** Prefill Navigation search so that catalog group is focused. */
  focusGroup?: string
}

export function SettingsForm({
  settings,
  onUpdate,
  onClose,
  initialTab = 'general',
  focusGroup,
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

  const [activeTab, setActiveTab] = useState(initialTab)
  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])
  const activeLabel =
    navGroups
      .flatMap((group) => group.items)
      .find((item) => item.value === activeTab)?.label ?? 'Settings'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={(value) => value && setActiveTab(value)}
        orientation="vertical"
        className="flex min-h-0 min-w-0 flex-1 gap-0 max-sm:flex-col"
      >
        <aside className="flex w-44 shrink-0 flex-col border-r border-border px-3 py-4 max-sm:max-h-40 max-sm:w-full max-sm:overflow-auto max-sm:border-r-0 max-sm:border-b max-sm:py-2 sm:w-48">
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
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-4">
            <GeneralTab
              settings={settings}
              onUpdate={onUpdate}
              defaultTimezone={defaultTimezone}
              isLoadingDefault={isLoadingDefault}
              isUsingDefault={!!isUsingDefault}
              onResetTimezone={handleResetTimezone}
            />

            <AppearanceTab
              settings={settings}
              onUpdate={onUpdate}
              onThemeChange={handleThemeChange}
            />

            <UnitsTab settings={settings} onUpdate={onUpdate} />

            <LayoutTab settings={settings} onUpdate={onUpdate} />

            <NavigationTab
              settings={settings}
              onUpdate={onUpdate}
              focusGroup={focusGroup}
            />

            <IntegrationsTab />
          </div>
          <div className="flex justify-end border-t border-border px-5 py-3">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </Tabs>
    </div>
  )
}
