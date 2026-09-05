import { toast } from 'sonner'

import type { AlertRouteProvider } from '@/lib/hooks/use-alert-routes'

import {
  NtfyFields,
  PagerDutyFields,
  PushoverFields,
  TelegramFields,
  WebhookFields,
} from './destination-fields'
import { TEST_ALERT } from './types'
import { useState } from 'react'
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
import {
  fireNtfyTest,
  firePagerDutyTest,
  firePushoverTest,
  fireTelegramTest,
} from '@/lib/health/alert-dispatcher'
import {
  useAlertRoutesMutations,
  usePagerDutyServices,
} from '@/lib/hooks/use-alert-routes'
import { describeError } from '@/lib/swr/fetch-error'

export function AddRouteForm({ onCreated }: { onCreated: () => void }) {
  const [matchRule, setMatchRule] = useState('*')
  const [matchHost, setMatchHost] = useState('*')
  const [provider, setProvider] = useState<AlertRouteProvider>('webhook')
  const [channelUrl, setChannelUrl] = useState('')
  const [pdServiceId, setPdServiceId] = useState('')
  const [pdServiceName, setPdServiceName] = useState('')
  const [pdRoutingKey, setPdRoutingKey] = useState('')
  const [tgBotToken, setTgBotToken] = useState('')
  const [tgChatId, setTgChatId] = useState('')
  const [ntfyUrl, setNtfyUrl] = useState('')
  const [ntfyToken, setNtfyToken] = useState('')
  const [poToken, setPoToken] = useState('')
  const [poUser, setPoUser] = useState('')
  // Per-route severity floor (#2661); '' = inherit the channel/global gate.
  const [minSeverity, setMinSeverity] = useState<'' | 'warning' | 'critical'>(
    ''
  )
  const [busy, setBusy] = useState(false)
  const { createRoute } = useAlertRoutesMutations()
  const { services: pdServices, isLoading: pdServicesLoading } =
    usePagerDutyServices(provider === 'pagerduty')

  const reset = () => {
    setMatchRule('*')
    setMatchHost('*')
    setChannelUrl('')
    setPdServiceId('')
    setPdServiceName('')
    setPdRoutingKey('')
    setTgBotToken('')
    setTgChatId('')
    setNtfyUrl('')
    setNtfyToken('')
    setPoToken('')
    setPoUser('')
    setMinSeverity('')
  }

  const handleSubmit = async () => {
    if (provider === 'pagerduty') {
      if (!pdRoutingKey.trim()) {
        toast.error("Enter the service's PagerDuty routing/integration key")
        return
      }
    } else if (provider === 'telegram') {
      if (!tgBotToken.trim() || !tgChatId.trim()) {
        toast.error('Enter the Telegram bot token and chat id')
        return
      }
    } else if (provider === 'ntfy') {
      if (!ntfyUrl.trim()) {
        toast.error('Enter the ntfy topic URL')
        return
      }
    } else if (provider === 'pushover') {
      if (!poToken.trim() || !poUser.trim()) {
        toast.error('Enter the Pushover application token and user key')
        return
      }
    } else if (!channelUrl.trim()) {
      toast.error('Enter a channel webhook URL')
      return
    }

    setBusy(true)
    try {
      await createRoute({
        matchRule: matchRule.trim() || '*',
        matchHost: matchHost.trim() || '*',
        minSeverity: minSeverity || undefined,
        ...(provider === 'pagerduty'
          ? {
              provider: 'pagerduty',
              serviceName: pdServiceName.trim() || undefined,
              routingKey: pdRoutingKey.trim(),
            }
          : provider === 'telegram'
            ? {
                provider: 'telegram',
                telegramBotToken: tgBotToken.trim(),
                telegramChatId: tgChatId.trim(),
              }
            : provider === 'ntfy'
              ? {
                  provider: 'ntfy',
                  ntfyUrl: ntfyUrl.trim(),
                  ntfyToken: ntfyToken.trim() || undefined,
                }
              : provider === 'pushover'
                ? {
                    provider: 'pushover',
                    pushoverToken: poToken.trim(),
                    pushoverUser: poUser.trim(),
                  }
                : { channelUrl: channelUrl.trim() }),
      })
      toast.success('Route created')
      reset()
      onCreated()
    } catch (err) {
      toast.error('Failed to create route', { description: describeError(err) })
    } finally {
      setBusy(false)
    }
  }

  const handleSendTest = async () => {
    if (!pdRoutingKey.trim()) {
      toast.error("Enter the service's PagerDuty routing/integration key")
      return
    }
    setBusy(true)
    try {
      const ok = await firePagerDutyTest(TEST_ALERT, pdRoutingKey.trim())
      if (ok) toast.success('Test event sent to PagerDuty')
      else toast.error('PagerDuty Events API request failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSendTelegramTest = async () => {
    if (!tgBotToken.trim() || !tgChatId.trim()) {
      toast.error('Enter the Telegram bot token and chat id')
      return
    }
    setBusy(true)
    try {
      const ok = await fireTelegramTest(
        TEST_ALERT,
        tgBotToken.trim(),
        tgChatId.trim()
      )
      if (ok) toast.success('Test message sent to Telegram')
      else toast.error('Telegram Bot API request failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSendNtfyTest = async () => {
    if (!ntfyUrl.trim()) {
      toast.error('Enter the ntfy topic URL')
      return
    }
    setBusy(true)
    try {
      const ok = await fireNtfyTest(
        ntfyUrl.trim(),
        ntfyToken.trim() || undefined
      )
      if (ok) toast.success('Test notification sent to ntfy')
      else toast.error('ntfy request failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSendPushoverTest = async () => {
    if (!poToken.trim() || !poUser.trim()) {
      toast.error('Enter the Pushover application token and user key')
      return
    }
    setBusy(true)
    try {
      const ok = await firePushoverTest(poToken.trim(), poUser.trim())
      if (ok) toast.success('Test notification sent to Pushover')
      else toast.error('Pushover request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <Label className="text-sm font-medium">Add route</Label>
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Destination</Label>
        <Select
          value={provider}
          onValueChange={(v) => setProvider(v as AlertRouteProvider)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="webhook">
              Channel webhook (Slack/Discord/…)
            </SelectItem>
            <SelectItem value="pagerduty">PagerDuty service</SelectItem>
            <SelectItem value="telegram">Telegram chat</SelectItem>
            <SelectItem value="ntfy">ntfy topic</SelectItem>
            <SelectItem value="pushover">Pushover user</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="route-match-rule"
            className="text-xs text-muted-foreground"
          >
            Rule id / type (or *, glob)
          </Label>
          <Input
            id="route-match-rule"
            placeholder="disk-usage or disk-*"
            value={matchRule}
            onChange={(e) => setMatchRule(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="route-match-host"
            className="text-xs text-muted-foreground"
          >
            Host id / name (or *, glob)
          </Label>
          <Input
            id="route-match-host"
            placeholder="0 or prod-*"
            value={matchHost}
            onChange={(e) => setMatchHost(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">
          Minimum severity (this route)
        </Label>
        <Select
          value={minSeverity || 'inherit'}
          onValueChange={(v) =>
            setMinSeverity(v === 'inherit' ? '' : (v as 'warning' | 'critical'))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Inherit global gate</SelectItem>
            <SelectItem value="warning">Warning+</SelectItem>
            <SelectItem value="critical">Critical only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {provider === 'pagerduty' ? (
        <PagerDutyFields
          busy={busy}
          pdServices={pdServices}
          pdServicesLoading={pdServicesLoading}
          pdServiceId={pdServiceId}
          pdServiceName={pdServiceName}
          pdRoutingKey={pdRoutingKey}
          onServiceIdChange={(id, name) => {
            setPdServiceId(id)
            setPdServiceName(name)
          }}
          onServiceNameChange={setPdServiceName}
          onRoutingKeyChange={setPdRoutingKey}
          onSendTest={handleSendTest}
        />
      ) : provider === 'telegram' ? (
        <TelegramFields
          busy={busy}
          tgBotToken={tgBotToken}
          tgChatId={tgChatId}
          onBotTokenChange={setTgBotToken}
          onChatIdChange={setTgChatId}
          onSendTest={handleSendTelegramTest}
        />
      ) : provider === 'ntfy' ? (
        <NtfyFields
          busy={busy}
          ntfyUrl={ntfyUrl}
          ntfyToken={ntfyToken}
          onUrlChange={setNtfyUrl}
          onTokenChange={setNtfyToken}
          onSendTest={handleSendNtfyTest}
        />
      ) : provider === 'pushover' ? (
        <PushoverFields
          busy={busy}
          poToken={poToken}
          poUser={poUser}
          onTokenChange={setPoToken}
          onUserChange={setPoUser}
          onSendTest={handleSendPushoverTest}
        />
      ) : (
        <WebhookFields
          channelUrl={channelUrl}
          onChannelUrlChange={setChannelUrl}
        />
      )}

      <Button
        size="sm"
        className="self-start"
        disabled={busy}
        onClick={handleSubmit}
      >
        Add route
      </Button>
    </div>
  )
}
