/**
 * Cloud-mode scope notice for the silencing panels. A window or quiet hours is
 * saved under the signed-in user, but the scheduled sweep only checks env hosts,
 * so nothing it could silence exists yet. Self-hosted builds render nothing.
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
