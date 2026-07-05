import { CloudIcon, ExternalLinkIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { docsSiteUrl } from '@/lib/docs-site'

interface CloudOnlyNoticeProps {
  /** Feature name, e.g. "Billing" or "Organizations". */
  feature: string
  /** Override the default explanation. */
  description?: string
}

/**
 * Placeholder shown when a cloud-only surface (/billing, /organization) is
 * opened on a self-hosted (OSS) build. The sidebar already filters these out of
 * the menu on OSS — this guards direct URL access so the feature UI never
 * renders there either, and explains why instead of showing a dead page.
 */
export function CloudOnlyNotice({
  feature,
  description,
}: CloudOnlyNoticeProps) {
  return (
    <div className="mx-auto max-w-xl py-16">
      <Card>
        <CardHeader className="items-center text-center">
          <div className="bg-primary/10 mb-2 flex size-12 items-center justify-center rounded-xl">
            <CloudIcon className="text-primary size-6" />
          </div>
          <CardTitle>{feature} is a cloud feature</CardTitle>
          <CardDescription>
            {description ??
              'Self-hosting is free forever. This surface is part of the hosted cloud edition — sign in to the cloud product to use it.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button
            variant="outline"
            render={
              <a href={docsSiteUrl()} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon className="size-4" /> Read the docs
              </a>
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}
