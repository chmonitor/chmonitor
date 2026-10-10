import type { ReactNode } from 'react'

import {
  getSelection,
  resolveSelection,
  setSelection,
  subscribe,
} from './config-tabs-store'
import { TabsContent, TabsList, TabsTrigger } from 'fumadocs-ui/components/tabs'
import { Tabs as TabsRoot } from 'fumadocs-ui/components/tabs.unstyled'
import { useSyncExternalStore } from 'react'

export interface ConfigTabsProps {
  /** Tab labels, e.g. ['Docker', 'Helm', 'env', '.env']. */
  items: string[]
  /** Blocks sharing a groupId switch together. Defaults to "config". */
  groupId?: string
  defaultIndex?: number
  children: ReactNode
}

/**
 * One configuration shown several ways. Built on the same Fumadocs tab
 * primitives as the registered <Tabs> (same look), but the selection lives in
 * `config-tabs-store` so it syncs across the page and persists safely.
 * (Fumadocs' own `groupId`/`persist` touches storage without a try/catch.)
 */
export function ConfigTabs({
  items,
  groupId = 'config',
  defaultIndex = 0,
  children,
}: ConfigTabsProps) {
  const fallback = items[defaultIndex] ?? items[0] ?? ''
  const selected = useSyncExternalStore(
    (cb) => subscribe(groupId, cb),
    () => getSelection(groupId),
    () => null
  )
  const value = resolveSelection(selected, items, fallback)

  return (
    <TabsRoot
      value={value}
      onValueChange={(v) => setSelection(groupId, v)}
      className="my-4 flex flex-col overflow-hidden rounded-xl border bg-fd-secondary"
    >
      <TabsList>
        {items.map((item) => (
          <TabsTrigger key={item} value={item}>
            {item}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </TabsRoot>
  )
}

/** One panel of a <ConfigTabs>; `value` must match an entry in `items`. */
export function ConfigTab({
  value,
  children,
}: {
  value: string
  children: ReactNode
}) {
  return <TabsContent value={value}>{children}</TabsContent>
}
