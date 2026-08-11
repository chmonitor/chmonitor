import { Check, ChevronDown, Loader2, Waypoints } from 'lucide-react'

import type { PeerdbAuthUi, TestStatus } from './connection-form-schema'

import { isValidUrl } from './connection-form-schema'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * The "Advanced → PeerDB monitoring" collapsible: API URL, auth scheme +
 * secret, and the "Test PeerDB" action. Extracted verbatim from
 * `ConnectionForm`; state and handlers come from `usePeerdbConnection`.
 */
export function ConnectionPeerdbFields({
  advancedOpen,
  setAdvancedOpen,
  peerdbApiUrl,
  setPeerdbApiUrl,
  peerdbAuthUi,
  setPeerdbAuthUi,
  peerdbSecret,
  setPeerdbSecret,
  peerdbTest,
  setPeerdbTest,
  handleTestPeerdb,
}: {
  advancedOpen: boolean
  setAdvancedOpen: (open: boolean) => void
  peerdbApiUrl: string
  setPeerdbApiUrl: (value: string) => void
  peerdbAuthUi: PeerdbAuthUi
  setPeerdbAuthUi: (value: PeerdbAuthUi) => void
  peerdbSecret: string
  setPeerdbSecret: (value: string) => void
  peerdbTest: TestStatus
  setPeerdbTest: (status: TestStatus) => void
  handleTestPeerdb: () => void
}) {
  return (
    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md py-1 text-sm font-medium text-foreground">
        <span>Advanced</span>
        <ChevronDown
          className={`size-4 text-muted-foreground transition-transform ${
            advancedOpen ? 'rotate-180' : ''
          }`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-start gap-2">
            <Waypoints className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                PeerDB monitoring (optional)
              </p>
              <p className="text-xs text-muted-foreground">
                Link this connection&apos;s CDC replication — the PeerDB
                flow-api endpoint. Monitoring is view-only.
              </p>
            </div>
          </div>

          {/* API URL */}
          <div className="space-y-1.5">
            <Label htmlFor="peerdb-url" className="text-sm font-medium">
              API URL
            </Label>
            <Input
              id="peerdb-url"
              placeholder="https://peerdb.example.com/api"
              value={peerdbApiUrl}
              onChange={(e) => {
                setPeerdbApiUrl(e.target.value)
                if (peerdbTest.state !== 'idle')
                  setPeerdbTest({ state: 'idle' })
              }}
              autoComplete="off"
              type="url"
            />
            {peerdbApiUrl.trim().length > 0 &&
              !isValidUrl(peerdbApiUrl.trim()) && (
                <p className="text-xs text-destructive">
                  Enter a valid HTTP or HTTPS URL
                </p>
              )}
          </div>

          {/* Auth scheme + secret */}
          <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="peerdb-auth" className="text-sm font-medium">
                Auth
              </Label>
              <Select
                value={peerdbAuthUi}
                onValueChange={(v) => {
                  setPeerdbAuthUi(v as PeerdbAuthUi)
                  if (peerdbTest.state !== 'idle')
                    setPeerdbTest({ state: 'idle' })
                }}
              >
                <SelectTrigger id="peerdb-auth">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="basic">Password</SelectItem>
                  <SelectItem value="bearer">API token</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {peerdbAuthUi !== 'none' && (
              <div className="space-y-1.5">
                <Label htmlFor="peerdb-secret" className="text-sm font-medium">
                  {peerdbAuthUi === 'bearer' ? 'API token' : 'Password'}
                </Label>
                <Input
                  id="peerdb-secret"
                  type="password"
                  placeholder="••••••••"
                  value={peerdbSecret}
                  onChange={(e) => {
                    setPeerdbSecret(e.target.value)
                    if (peerdbTest.state !== 'idle')
                      setPeerdbTest({ state: 'idle' })
                  }}
                  autoComplete="off"
                />
              </div>
            )}
          </div>

          {/* Test PeerDB */}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestPeerdb}
              disabled={
                peerdbApiUrl.trim().length === 0 ||
                !isValidUrl(peerdbApiUrl.trim()) ||
                peerdbTest.state === 'loading'
              }
            >
              {peerdbTest.state === 'loading' ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : null}
              Test PeerDB
            </Button>
            {peerdbTest.state === 'success' && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <Check className="size-3.5" />
                {peerdbTest.message}
              </span>
            )}
            {peerdbTest.state === 'error' && (
              <span className="text-xs text-destructive">
                {peerdbTest.message}
              </span>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
