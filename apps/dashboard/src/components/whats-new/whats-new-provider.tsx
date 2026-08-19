import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { WhatsNewDialog } from '@/components/whats-new/whats-new-dialog'
import { useUserSettings } from '@/lib/hooks/use-user-settings'
import { APP_VERSION } from '@/lib/whats-new/app-version'
import {
  markAutoOpenedVersion,
  readAutoOpenedVersion,
  shouldAutoOpenChangelog,
} from '@/lib/whats-new/last-seen'
import { useReleases } from '@/lib/whats-new/use-releases'
import { hasUnseenChangelog, hasUnseenUpgrade } from '@/lib/whats-new/version'

interface WhatsNewContextValue {
  open: () => void
  hasUnseen: boolean
}

const WhatsNewContext = createContext<WhatsNewContextValue | null>(null)

export function WhatsNewProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const autoOpenedRef = useRef(false)
  const { settings, updateSettings, mounted } = useUserSettings()
  const { releases, error, isLoading, refetch } = useReleases()

  const hasUnseen = hasUnseenChangelog(
    APP_VERSION,
    settings.lastSeenChangelogVersion
  )
  const hasUpgrade = hasUnseenUpgrade(
    APP_VERSION,
    settings.lastSeenChangelogVersion
  )

  const markSeen = useCallback(() => {
    updateSettings({ lastSeenChangelogVersion: APP_VERSION })
  }, [updateSettings])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (!next && autoOpenedRef.current) {
        markSeen()
        autoOpenedRef.current = false
      }
    },
    [markSeen]
  )

  const handleGotIt = useCallback(() => {
    markSeen()
    autoOpenedRef.current = false
    setOpen(false)
  }, [markSeen])

  const openDialog = useCallback(() => {
    setOpen(true)
  }, [])

  useEffect(() => {
    if (!mounted || isLoading) return
    if (
      !shouldAutoOpenChangelog({
        appVersion: APP_VERSION,
        hasUpgrade,
        alreadyOpenedVersion: readAutoOpenedVersion(),
      })
    ) {
      return
    }
    autoOpenedRef.current = true
    markAutoOpenedVersion(APP_VERSION)
    setOpen(true)
  }, [mounted, isLoading, hasUpgrade])

  const value = useMemo(
    () => ({ open: openDialog, hasUnseen }),
    [openDialog, hasUnseen]
  )

  return (
    <WhatsNewContext.Provider value={value}>
      {children}
      <WhatsNewDialog
        open={open}
        onOpenChange={handleOpenChange}
        onGotIt={handleGotIt}
        releases={releases}
        isLoading={isLoading}
        error={error}
        onRetry={() => {
          void refetch()
        }}
      />
    </WhatsNewContext.Provider>
  )
}

const NOOP_WHATS_NEW: WhatsNewContextValue = {
  open: () => {},
  hasUnseen: false,
}

export function useWhatsNew(): WhatsNewContextValue {
  return useContext(WhatsNewContext) ?? NOOP_WHATS_NEW
}
