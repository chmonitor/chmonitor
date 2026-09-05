import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type PdService = { id: string; name: string }

export function PagerDutyFields({
  busy,
  pdServices,
  pdServicesLoading,
  pdServiceId,
  pdServiceName,
  pdRoutingKey,
  onServiceIdChange,
  onServiceNameChange,
  onRoutingKeyChange,
  onSendTest,
}: {
  busy: boolean
  pdServices: PdService[]
  pdServicesLoading: boolean
  pdServiceId: string
  pdServiceName: string
  pdRoutingKey: string
  onServiceIdChange: (id: string, name: string) => void
  onServiceNameChange: (name: string) => void
  onRoutingKeyChange: (key: string) => void
  onSendTest: () => void
}) {
  return (
    <>
      <Label className="text-xs text-muted-foreground">
        PagerDuty service {pdServicesLoading && '(loading…)'}
      </Label>
      {pdServices.length > 0 && (
        <Select
          value={pdServiceId}
          onValueChange={(id) => {
            if (id == null) return
            const svc = pdServices.find((s) => s.id === id)
            onServiceIdChange(id, svc?.name ?? '')
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pick a listed service…" />
          </SelectTrigger>
          <SelectContent>
            {pdServices.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Input
        placeholder="Service display name (optional)"
        value={pdServiceName}
        onChange={(e) => onServiceNameChange(e.target.value)}
      />
      <Input
        placeholder="Service integration/routing key"
        value={pdRoutingKey}
        onChange={(e) => onRoutingKeyChange(e.target.value)}
      />
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={busy}
        onClick={onSendTest}
      >
        Send test event
      </Button>
    </>
  )
}

export function TelegramFields({
  busy,
  tgBotToken,
  tgChatId,
  onBotTokenChange,
  onChatIdChange,
  onSendTest,
}: {
  busy: boolean
  tgBotToken: string
  tgChatId: string
  onBotTokenChange: (v: string) => void
  onChatIdChange: (v: string) => void
  onSendTest: () => void
}) {
  return (
    <>
      <Label
        htmlFor="route-telegram-token"
        className="text-xs text-muted-foreground"
      >
        Bot token
      </Label>
      <Input
        id="route-telegram-token"
        placeholder="123456:ABC-DEF..."
        value={tgBotToken}
        onChange={(e) => onBotTokenChange(e.target.value)}
      />
      <Label
        htmlFor="route-telegram-chat"
        className="text-xs text-muted-foreground"
      >
        Chat id
      </Label>
      <Input
        id="route-telegram-chat"
        placeholder="-1001234567890 or @channelname"
        value={tgChatId}
        onChange={(e) => onChatIdChange(e.target.value)}
      />
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={busy}
        onClick={onSendTest}
      >
        Send test message
      </Button>
    </>
  )
}

export function NtfyFields({
  busy,
  ntfyUrl,
  ntfyToken,
  onUrlChange,
  onTokenChange,
  onSendTest,
}: {
  busy: boolean
  ntfyUrl: string
  ntfyToken: string
  onUrlChange: (v: string) => void
  onTokenChange: (v: string) => void
  onSendTest: () => void
}) {
  return (
    <>
      <Label htmlFor="route-ntfy-url" className="text-xs text-muted-foreground">
        Topic URL
      </Label>
      <Input
        id="route-ntfy-url"
        placeholder="https://ntfy.sh/my-topic"
        value={ntfyUrl}
        onChange={(e) => onUrlChange(e.target.value)}
      />
      <Label
        htmlFor="route-ntfy-token"
        className="text-xs text-muted-foreground"
      >
        Access token (optional)
      </Label>
      <Input
        id="route-ntfy-token"
        placeholder="tk_… (only for protected topics)"
        value={ntfyToken}
        onChange={(e) => onTokenChange(e.target.value)}
      />
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={busy}
        onClick={onSendTest}
      >
        Send test notification
      </Button>
    </>
  )
}

export function PushoverFields({
  busy,
  poToken,
  poUser,
  onTokenChange,
  onUserChange,
  onSendTest,
}: {
  busy: boolean
  poToken: string
  poUser: string
  onTokenChange: (v: string) => void
  onUserChange: (v: string) => void
  onSendTest: () => void
}) {
  return (
    <>
      <Label
        htmlFor="route-pushover-token"
        className="text-xs text-muted-foreground"
      >
        Application API token
      </Label>
      <Input
        id="route-pushover-token"
        placeholder="a1b2c3..."
        value={poToken}
        onChange={(e) => onTokenChange(e.target.value)}
      />
      <Label
        htmlFor="route-pushover-user"
        className="text-xs text-muted-foreground"
      >
        User (or group) key
      </Label>
      <Input
        id="route-pushover-user"
        placeholder="u1v2w3..."
        value={poUser}
        onChange={(e) => onUserChange(e.target.value)}
      />
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={busy}
        onClick={onSendTest}
      >
        Send test notification
      </Button>
    </>
  )
}

export function WebhookFields({
  channelUrl,
  onChannelUrlChange,
}: {
  channelUrl: string
  onChannelUrlChange: (v: string) => void
}) {
  return (
    <>
      <Label
        htmlFor="route-channel-url"
        className="text-xs text-muted-foreground"
      >
        Channel webhook URL
      </Label>
      <Input
        id="route-channel-url"
        placeholder="https://hooks.slack.com/services/..."
        value={channelUrl}
        onChange={(e) => onChannelUrlChange(e.target.value)}
      />
    </>
  )
}
