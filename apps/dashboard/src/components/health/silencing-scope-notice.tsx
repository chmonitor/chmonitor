/**
 * Cloud-mode scope notice for the silencing panels (#3802).
 *
 * In cloud mode a maintenance window or quiet hours is saved under the
 * signed-in user, but the scheduled sweep only checks the env hosts and never
 * the user's own connections — so nothing it could silence exists yet. This
 * says so plainly instead of letting the panel look armed. Self-hosted builds
 * render nothing: there the sweep reads the same single-tenant rows the UI
 * writes. The per-owner sweep that removes this notice is tracked on #3802.
 */

import { Info } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { isCloudModeClient } from '@/lib/cloud/cloud-mode'
import { cn } from '@/lib/utils'

export function silencingScopeNoticeText(
  feature: string,
  cloudMode: boolean
): string | null {
  if (!cloudMode) return null
  return `${feature} apply to your own connections, and those are not checked for alerts yet, so for now they do not silence any alert.`
}

export function SilencingScopeNotice({
  feature,
  className,
}: {
  /** Plural noun phrase, e.g. "Maintenance windows". */
  feature: string
  className?: string
}) {
  const text = silencingScopeNoticeText(feature, isCloudModeClient())
  if (!text) return null
  return (
    <Alert className={cn(className)} data-silencing-scope="">
      <Info aria-hidden />
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  )
}
