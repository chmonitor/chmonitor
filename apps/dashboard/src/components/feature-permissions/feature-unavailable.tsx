import { LockKeyholeIcon, PowerOffIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useHostId } from '@/lib/swr'

interface FeatureUnavailableProps {
  feature: string
  reason: 'disabled' | 'auth'
}

export function FeatureUnavailable({
  feature,
  reason,
}: FeatureUnavailableProps) {
  const hostId = useHostId()
  const isAuth = reason === 'auth'
  const Icon = isAuth ? LockKeyholeIcon : PowerOffIcon

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Icon className="size-5 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h1 className="font-semibold text-xl">
              {isAuth ? 'Authentication required' : 'Feature disabled'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {isAuth
                ? `The ${feature} feature requires a signed-in session.`
                : `The ${feature} feature is disabled for this deployment.`}
            </p>
          </div>
          <Button
            variant="outline"
            render={<a href={`/overview?host=${hostId}`}>Go to overview</a>}
          />
        </CardContent>
      </Card>
    </div>
  )
}
