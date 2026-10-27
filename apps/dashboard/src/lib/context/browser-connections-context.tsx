import type { BrowserConnection } from '@/lib/types/browser-connection'

import { createContext, useCallback, useEffect, useState } from 'react'
import { BROWSER_CONNECTIONS_STORAGE_KEY } from '@/lib/types/browser-connection'

interface BrowserConnectionsContextValue {
  connections: BrowserConnection[]
  getConnection: (hostId: number) => BrowserConnection | undefined
}

const BrowserConnectionsContext = createContext<BrowserConnectionsContextValue>(
  {
    connections: [],
    getConnection: () => undefined,
  }
)

/**
 * Provides browser connections loaded from localStorage to the component tree.
 * Syncs with localStorage changes across tabs via the 'storage' event.
 */
export function BrowserConnectionsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [connections, setConnections] = useState<BrowserConnection[]>([])

  useEffect(() => {
    function load() {
      try {
        const raw = localStorage.getItem(BROWSER_CONNECTIONS_STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as BrowserConnection[]
          setConnections(Array.isArray(parsed) ? parsed : [])
        } else {
          setConnections([])
        }
      } catch {
        setConnections([])
      }
    }

    load()

    // Sync across tabs
    const handleStorage = (e: StorageEvent) => {
      if (e.key === BROWSER_CONNECTIONS_STORAGE_KEY) {
        load()
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const getConnection = useCallback(
    (hostId: number) => connections.find((c) => c.hostId === hostId),
    [connections]
  )

  return (
    <BrowserConnectionsContext.Provider value={{ connections, getConnection }}>
      {children}
    </BrowserConnectionsContext.Provider>
  )
}
