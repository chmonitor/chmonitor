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
import { slackWebhookTeamId } from '@/lib/slack/channel-id'

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

export function MatrixFields({
  busy,
  mxHomeserverUrl,
  mxAccessToken,
  mxRoomId,
  onHomeserverUrlChange,
  onAccessTokenChange,
  onRoomIdChange,
  onSendTest,
}: {
  busy: boolean
  mxHomeserverUrl: string
  mxAccessToken: string
  mxRoomId: string
  onHomeserverUrlChange: (v: string) => void
  onAccessTokenChange: (v: string) => void
  onRoomIdChange: (v: string) => void
  onSendTest: () => void
}) {
  return (
    <>
      <Label
        htmlFor="route-matrix-homeserver"
        className="text-xs text-muted-foreground"
      >
        Homeserver URL
      </Label>
      <Input
        id="route-matrix-homeserver"
        placeholder="https://matrix.example.org"
        value={mxHomeserverUrl}
        onChange={(e) => onHomeserverUrlChange(e.target.value)}
      />
      <Label
        htmlFor="route-matrix-token"
        className="text-xs text-muted-foreground"
      >
        Bot access token
      </Label>
      <Input
        id="route-matrix-token"
        type="password"
        autoComplete="off"
        placeholder="syt_…"
        value={mxAccessToken}
        onChange={(e) => onAccessTokenChange(e.target.value)}
      />
      <Label
        htmlFor="route-matrix-room"
        className="text-xs text-muted-foreground"
      >
        Room id
      </Label>
      <Input
        id="route-matrix-room"
        placeholder="!abc123:example.org"
        aria-describedby="route-matrix-help"
        value={mxRoomId}
        onChange={(e) => onRoomIdChange(e.target.value)}
      />
      <p id="route-matrix-help" className="text-xs text-muted-foreground">
        The bot account must already be joined to the room. Find the room id in
        Element under Room settings, Advanced. Messages to end-to-end encrypted
        rooms are sent unencrypted.
      </p>
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

export function WebhookFields({
  channelUrl,
  slackChannelId,
  onChannelUrlChange,
  onSlackChannelIdChange,
}: {
  channelUrl: string
  slackChannelId: string
  onChannelUrlChange: (v: string) => void
  onSlackChannelIdChange: (v: string) => void
}) {
  const isSlack = slackWebhookTeamId(channelUrl.trim()) !== null
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
      {isSlack && (
        <>
          <Label
            htmlFor="route-slack-channel"
            className="text-xs text-muted-foreground"
          >
            Slack channel id (optional)
          </Label>
          <Input
            id="route-slack-channel"
            placeholder="C0123456789"
            aria-describedby="route-slack-channel-help"
            value={slackChannelId}
            onChange={(e) => onSlackChannelIdChange(e.target.value)}
          />
          <p
            id="route-slack-channel-help"
            className="text-xs text-muted-foreground"
          >
            With the chmonitor Slack app installed in this workspace and invited
            to the channel, alerts post as one line with details in a thread,
            and the line is edited when the alert resolves. Leave empty to post
            through the webhook only.
          </p>
        </>
      )}
    </>
  )
}
