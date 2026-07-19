import { useCallback, useSyncExternalStore } from 'react'

/**
 * Per-page view settings for /traffic, persisted in localStorage.
 *
 * Each optional section has a three-state visibility: 'auto' follows the
 * page's smart detection (part_log probe, cluster-shape probe, PeerDB probe),
 * while 'show' / 'hide' are explicit user overrides. Named presets are just
 * predefined section maps — applying one overwrites the current map.
 */

export const TRAFFIC_SECTION_IDS = [
  'bytesOnDisk',
  'merges',
  'topTables',
  'replication',
  'peerdb',
] as const

export type TrafficSectionId = (typeof TRAFFIC_SECTION_IDS)[number]

export type TrafficSectionVisibility = 'auto' | 'show' | 'hide'

/** 'full' = regular chart grid; 'compact' = dense mini-chart row. */
export type TrafficSectionDensity = 'full' | 'compact'

export interface TrafficSettings {
  sections: Record<TrafficSectionId, TrafficSectionVisibility>
  density: Record<TrafficSectionId, TrafficSectionDensity>
}

export const TRAFFIC_SECTION_LABELS: Record<TrafficSectionId, string> = {
  bytesOnDisk: 'Bytes on Disk',
  merges: 'Merges & Data Movement',
  topTables: 'Top Tables by Ingestion',
  replication: 'Replication & Distribution',
  peerdb: 'PeerDB Ingestion',
}

export const DEFAULT_TRAFFIC_SETTINGS: TrafficSettings = {
  sections: {
    bytesOnDisk: 'auto',
    merges: 'auto',
    topTables: 'auto',
    replication: 'auto',
    peerdb: 'auto',
  },
  density: {
    bytesOnDisk: 'full',
    merges: 'full',
    topTables: 'full',
    replication: 'full',
    peerdb: 'full',
  },
}

export interface TrafficPreset {
  id: string
  label: string
  description: string
  sections: Record<TrafficSectionId, TrafficSectionVisibility>
}

export const TRAFFIC_PRESETS: readonly TrafficPreset[] = [
  {
    id: 'auto',
    label: 'Auto',
    description: 'Smart detection decides which sections are relevant',
    sections: DEFAULT_TRAFFIC_SETTINGS.sections,
  },
  {
    id: 'ingest',
    label: 'Ingest focus',
    description: 'Only incoming data: rows, bytes, and insert queries',
    sections: {
      bytesOnDisk: 'auto',
      merges: 'hide',
      topTables: 'hide',
      replication: 'hide',
      peerdb: 'auto',
    },
  },
  {
    id: 'storage',
    label: 'Storage & merges',
    description: 'On-disk volume, merge activity, and per-table breakdown',
    sections: {
      bytesOnDisk: 'show',
      merges: 'show',
      topTables: 'show',
      replication: 'auto',
      peerdb: 'hide',
    },
  },
  {
    id: 'all',
    label: 'Everything',
    description: 'Force-show every section, even when undetected',
    sections: {
      bytesOnDisk: 'show',
      merges: 'show',
      topTables: 'show',
      replication: 'show',
      peerdb: 'show',
    },
  },
]

const STORAGE_KEY = 'traffic-view-settings'
const CHANGE_EVENT = 'traffic-view-settings-changed'

function isVisibility(value: unknown): value is TrafficSectionVisibility {
  return value === 'auto' || value === 'show' || value === 'hide'
}

function isDensity(value: unknown): value is TrafficSectionDensity {
  return value === 'full' || value === 'compact'
}

export function loadTrafficSettings(): TrafficSettings {
  if (typeof window === 'undefined') return DEFAULT_TRAFFIC_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_TRAFFIC_SETTINGS
    const parsed = JSON.parse(raw) as {
      sections?: Record<string, unknown>
      density?: Record<string, unknown>
    }
    const sections = { ...DEFAULT_TRAFFIC_SETTINGS.sections }
    const density = { ...DEFAULT_TRAFFIC_SETTINGS.density }
    for (const id of TRAFFIC_SECTION_IDS) {
      const value = parsed?.sections?.[id]
      if (isVisibility(value)) sections[id] = value
      const densityValue = parsed?.density?.[id]
      if (isDensity(densityValue)) density[id] = densityValue
    }
    return { sections, density }
  } catch {
    return DEFAULT_TRAFFIC_SETTINGS
  }
}

export function saveTrafficSettings(settings: TrafficSettings): boolean {
  if (typeof window === 'undefined') return false
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    cachedSnapshot = null
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
    return true
  } catch {
    return false
  }
}

// Snapshot cache so useSyncExternalStore gets a referentially stable value
// between changes (a fresh object every getSnapshot call would loop renders).
let cachedSnapshot: TrafficSettings | null = null

function getSnapshot(): TrafficSettings {
  if (!cachedSnapshot) cachedSnapshot = loadTrafficSettings()
  return cachedSnapshot
}

function getServerSnapshot(): TrafficSettings {
  return DEFAULT_TRAFFIC_SETTINGS
}

function subscribe(onStoreChange: () => void): () => void {
  const invalidate = () => {
    cachedSnapshot = null
    onStoreChange()
  }
  window.addEventListener(CHANGE_EVENT, invalidate)
  // Cross-tab sync: the storage event fires in other tabs on localStorage writes
  window.addEventListener('storage', invalidate)
  return () => {
    window.removeEventListener(CHANGE_EVENT, invalidate)
    window.removeEventListener('storage', invalidate)
  }
}

/** Matching preset id for the current section map, or undefined. */
export function matchPresetId(settings: TrafficSettings): string | undefined {
  return TRAFFIC_PRESETS.find((preset) =>
    TRAFFIC_SECTION_IDS.every(
      (id) => preset.sections[id] === settings.sections[id]
    )
  )?.id
}

export function useTrafficSettings() {
  const settings = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  )

  const setSectionVisibility = useCallback(
    (id: TrafficSectionId, visibility: TrafficSectionVisibility) => {
      const current = loadTrafficSettings()
      saveTrafficSettings({
        ...current,
        sections: { ...current.sections, [id]: visibility },
      })
    },
    []
  )

  const toggleSectionDensity = useCallback((id: TrafficSectionId) => {
    const current = loadTrafficSettings()
    saveTrafficSettings({
      ...current,
      density: {
        ...current.density,
        [id]: current.density[id] === 'compact' ? 'full' : 'compact',
      },
    })
  }, [])

  // Presets only cover visibility; the per-section density choice sticks.
  const applyPreset = useCallback((presetId: string) => {
    const preset = TRAFFIC_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const current = loadTrafficSettings()
    saveTrafficSettings({ ...current, sections: { ...preset.sections } })
  }, [])

  return {
    settings,
    setSectionVisibility,
    toggleSectionDensity,
    applyPreset,
    activePresetId: matchPresetId(settings),
  }
}
