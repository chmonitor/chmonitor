import { useEffect, useState } from 'react'
import {
  decryptJson,
  encryptJson,
} from '@/lib/connection-crypto/browser-crypto'
import { invalidateBrowserConnectionSession } from '@/lib/connection-sessions/session-manager'
import {
  BROWSER_CONNECTIONS_STORAGE_KEY,
  type BrowserConnection,
  type EncryptedBrowserConnectionsStore,
  nextBrowserConnectionHostId,
} from '@/lib/types/browser-connection'

async function loadConnections(): Promise<BrowserConnection[]> {
  if (typeof window === 'undefined') return []

  try {
    const stored = localStorage.getItem(BROWSER_CONNECTIONS_STORAGE_KEY)
    if (!stored) return []

    const parsed = JSON.parse(stored) as
      | EncryptedBrowserConnectionsStore
      | BrowserConnection[]

    if (Array.isArray(parsed)) {
      // Legacy plaintext — migrate on next save; return as-is for now.
      return parsed
    }

    if (parsed.version === 2 && parsed.encrypted) {
      return decryptJson<BrowserConnection[]>(parsed.encrypted)
    }
  } catch (error) {
    // A decrypt failure here means stored connections are unrecoverable (e.g. a
    // device key was regenerated). Log a distinct, diagnosable warning rather
    // than silently dropping them into the empty-list fallback below.
    console.error(
      'Failed to load browser connections (stored connections could not be decrypted):',
      error
    )
  }

  return []
}

async function saveConnections(
  connections: BrowserConnection[]
): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    const encrypted = await encryptJson(connections)
    const envelope: EncryptedBrowserConnectionsStore = {
      version: 2,
      encrypted,
    }
    localStorage.setItem(
      BROWSER_CONNECTIONS_STORAGE_KEY,
      JSON.stringify(envelope)
    )
  } catch (error) {
    console.error('Failed to save browser connections:', error)
  }
}

export function useBrowserConnections() {
  const [connections, setConnections] = useState<BrowserConnection[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    void loadConnections().then((loaded) => {
      setConnections(loaded)
      setMounted(true)
    })
  }, [])

  const addConnection = (
    input: Omit<BrowserConnection, 'id' | 'hostId' | 'createdAt' | 'updatedAt'>
  ): BrowserConnection => {
    const now = new Date().toISOString()
    const newConnection: BrowserConnection = {
      ...input,
      id: crypto.randomUUID(),
      hostId: 0,
      createdAt: now,
      updatedAt: now,
    }

    // Derive the (negative) hostId deterministically from the current state
    // BEFORE dispatching, so the returned object is stable and correct. The
    // React state updater does not run synchronously with this call, so we must
    // not read the computed hostId back out of it (that returned hostId: 0, the
    // placeholder, and navigated callers to ?host=0 — the first env host).
    const hostId = nextBrowserConnectionHostId(connections)
    const result: BrowserConnection = { ...newConnection, hostId }

    setConnections((prev) => {
      const updated = [...prev, result]
      void saveConnections(updated)
      return updated
    })

    return result
  }

  const updateConnection = (
    id: string,
    updates: Partial<Omit<BrowserConnection, 'id' | 'hostId' | 'createdAt'>>
  ): void => {
    setConnections((prev) => {
      const updated = prev.map((c) =>
        c.id === id
          ? { ...c, ...updates, updatedAt: new Date().toISOString() }
          : c
      )
      void saveConnections(updated)
      invalidateBrowserConnectionSession(id)
      return updated
    })
  }

  const deleteConnection = (id: string): void => {
    setConnections((prev) => {
      const updated = prev.filter((c) => c.id !== id)
      void saveConnections(updated)
      invalidateBrowserConnectionSession(id)
      return updated
    })
  }

  const getConnectionByHostId = (
    hostId: number
  ): BrowserConnection | undefined =>
    connections.find((c) => c.hostId === hostId)

  return {
    connections,
    addConnection,
    updateConnection,
    deleteConnection,
    getConnectionByHostId,
    mounted,
  }
}
