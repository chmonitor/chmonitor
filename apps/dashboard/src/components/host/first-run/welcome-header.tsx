import type { ReactNode } from 'react'

import { ChmonitorLogo } from '@/components/icons/chmonitor-logo'
import { WelcomeIllustration } from '@/components/illustrations/welcome-illustration'

export function WelcomeHeader({
  title,
  subtitle,
}: {
  title: string
  subtitle: ReactNode
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <WelcomeIllustration className="mb-4" />
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl border bg-card shadow-sm">
        <ChmonitorLogo width={28} height={28} className="size-7" />
      </div>
      <h1 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">
        {title}
      </h1>
      <p className="mt-2 text-pretty text-sm text-muted-foreground">
        {subtitle}
      </p>
    </div>
  )
}
