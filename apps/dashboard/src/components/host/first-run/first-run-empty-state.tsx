import type { ReactNode } from 'react'
import type { ConnectionPreset } from '@/components/connections/connection-presets'
import type { OpenAddHostOptions } from './engine-chooser'

import { ConnectYourHost } from './connect-your-host'
import { SelfHostedSetup } from './self-hosted-setup'
import { SignInToConnect } from './sign-in-to-connect'
import { useState } from 'react'
import { AddHostDialog } from '@/components/connections'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'

/**
 * First-run onboarding / welcome surface.
 *
 * Rendered by `FirstRunGate` when the visitor has ZERO usable ClickHouse hosts.
 * The exact framing depends on the deployment:
 *
 *  - Cloud (SaaS), signed in → "Connect your ClickHouse" setup page. The demo
 *    was hidden once they signed in, so this is the moment to bring their own
 *    host. Primary action opens the Add-host dialog (server storage).
 *  - Cloud (SaaS), anonymous → "Sign in to connect" with the value prop.
 *  - Self-hosted (OSS) → operator-oriented guidance: set CLICKHOUSE_HOST env
 *    vars, or add a browser connection. Unchanged from the original behaviour.
 *
 * @see components/host/first-run-gate.tsx
 */
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
