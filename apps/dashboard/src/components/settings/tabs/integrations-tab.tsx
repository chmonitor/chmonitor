import { Globe } from 'lucide-react'

import { Field } from '../field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TabsContent } from '@/components/ui/tabs'

const COMING_SOON_INTEGRATIONS = [
  { name: 'Slack', description: 'Post health alerts to a Slack channel' },
  { name: 'Telegram', description: 'Send alerts to a Telegram chat' },
  { name: 'PagerDuty', description: 'Page on-call when a check fails' },
  { name: 'Email', description: 'Email a digest or incident notice' },
  { name: 'Discord', description: 'Post alerts to a Discord webhook' },
] as const

export function IntegrationsTab() {
  return (
    <TabsContent value="integrations" className="space-y-4 px-1 pb-2">
      <Field
        label="MCP Server"
        icon={Globe}
        description="Connect AI assistants to your ClickHouse cluster via the Model Context Protocol."
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start text-xs"
          onClick={() => window.open('/mcp', '_blank')}
        >
          <Globe className="mr-2 size-3" />
          View MCP Server Details
        </Button>
      </Field>

      <div className="space-y-2">
        <p className="text-sm font-medium">More channels</p>
        <p className="text-xs text-muted-foreground">
          These destinations are not wired yet. They stay visible so you can see
          what is coming.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {COMING_SOON_INTEGRATIONS.map((item) => (
            <div
              key={item.name}
              aria-disabled="true"
              className="flex flex-col gap-1 rounded-lg border border-dashed border-border bg-muted/10 px-3 py-2.5 opacity-60"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{item.name}</span>
                <Badge variant="secondary" className="text-[10px]">
                  Soon
                </Badge>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {item.description}
              </span>
            </div>
          ))}
        </div>
      </div>
    </TabsContent>
  )
}
