/**
 * SavedDashboardsToolbar
 *
 * Toolbar for managing saved dashboard configurations. Persists to D1 (per
 * signed-in owner, synced across devices) when server-side dashboard storage
 * is enabled, else falls back to localStorage — see
 * `@/lib/dashboard-storage`. Provides load, save, and delete operations via
 * simple UI controls.
 */

import { BookmarkIcon, TrashIcon } from '@radix-ui/react-icons'

import type { DashboardLayout } from '@/types/dashboard-layout'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  deleteDashboard,
  listDashboards,
  loadDashboard,
  saveDashboard,
} from '@/lib/dashboard-storage'

interface SavedDashboardsToolbarProps {
  /** Currently active layout, to save */
  layout: DashboardLayout
  /** Called when user loads a saved dashboard */
  onLoad: (layout: DashboardLayout) => void
}

export function SavedDashboardsToolbar({
  layout,
  onLoad,
}: SavedDashboardsToolbarProps) {
  const [savedNames, setSavedNames] = useState<string[]>([])
  const [activeName, setActiveName] = useState<string>('')

  // Refresh the list (D1 or localStorage, depending on backend).
  const refreshList = async () => {
    setSavedNames(await listDashboards())
  }

  // Load the saved list on mount (inline to keep an empty dependency array).
  useEffect(() => {
    let cancelled = false
    listDashboards().then((names) => {
      if (!cancelled) setSavedNames(names)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleLoad(name: string) {
    const loaded = await loadDashboard(name)
    if (loaded) {
      setActiveName(name)
      onLoad(loaded)
    }
  }

  async function handleSave() {
    if (layout.widgets.length === 0) {
      alert('Add at least one widget before saving.')
      return
    }
    const name = window.prompt('Dashboard name:')?.trim()
    if (!name) return
    try {
      await saveDashboard(name, layout)
      setActiveName(name)
      await refreshList()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save dashboard.')
    }
  }

  async function handleDelete() {
    if (!activeName) return
    if (!window.confirm(`Delete "${activeName}"?`)) return
    try {
      await deleteDashboard(activeName)
      setActiveName('')
      await refreshList()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete dashboard.')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={activeName}
        onValueChange={(value) => {
          if (value != null) void handleLoad(value)
        }}
      >
        <SelectTrigger
          className="w-full sm:w-48"
          aria-label={
            activeName
              ? `Saved dashboard: ${activeName}`
              : 'Load saved dashboard'
          }
        >
          <SelectValue placeholder="Saved dashboards…" />
        </SelectTrigger>
        <SelectContent>
          {savedNames.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No saved dashboards
            </div>
          ) : (
            savedNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="sm"
        onClick={handleSave}
        title="Save current dashboard"
      >
        <BookmarkIcon className="mr-1 size-3" />
        Save
      </Button>

      {activeName && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          title={`Delete "${activeName}"`}
          className="text-destructive hover:text-destructive"
        >
          <TrashIcon className="mr-1 size-3" />
          Delete
        </Button>
      )}
    </div>
  )
}
