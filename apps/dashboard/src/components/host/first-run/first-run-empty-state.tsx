import type { ReactNode } from 'react'
import type { ConnectionPreset } from '@/components/connections/connection-presets'
import type { OpenAddHostOptions } from './engine-chooser'

import { ConnectYourHost } from './connect-your-host'
import { SelfHostedSetup } from './self-hosted-setup'
import { SignInToConnect } from './sign-in-to-connect'
import { useState } from 'react'
import { AddHostDialog } from '@/components/connections'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'

export function FirstRunEmptyState() {
  const { cloudMode, isSignedIn } = useMergedHosts()
  const [addOpen, setAddOpen] = useState(false)
  const [addPreset, setAddPreset] = useState<'sample' | undefined>(undefined)
  const [addEngine, setAddEngine] = useState<ConnectionPreset>('self-hosted')

  // Every open sets preset + engine explicitly (including the defaults) — this
  // dialog instance is reused/toggled, not remounted per CTA, so leaving the
  // previous values in place would leak (e.g. "sample" or "postgres") into a
  // later plain "Connect ClickHouse" click.
  const openAddHost = (opts?: OpenAddHostOptions) => {
    setAddPreset(opts?.preset)
    setAddEngine(opts?.engine ?? 'self-hosted')
    setAddOpen(true)
  }

  let body: ReactNode
  if (cloudMode && isSignedIn) {
    body = <ConnectYourHost onAddHost={openAddHost} />
  } else if (cloudMode) {
    body = <SignInToConnect />
  } else {
    body = <SelfHostedSetup onAddHost={openAddHost} />
  }

  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-3xl">{body}</div>
      </div>
      <AddHostDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        initialPreset={addPreset}
        initialEngine={addEngine}
      />
    </>
  )
}
