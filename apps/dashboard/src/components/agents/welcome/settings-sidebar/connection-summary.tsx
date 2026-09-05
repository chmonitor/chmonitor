'use client'

import { ConversationHistoryRow } from './conversation-history-row'
import { LabeledRow } from './labeled-row'
import { StaticSectionHeader } from './static-section-header'
import { AgentModelPicker } from '@/components/agents/welcome/agent-model-picker'

/**
 * Primary block, always visible (never collapses): the host, model, and
 * conversation-history backend for this session. These are the controls
 * users reach for most, so they sit at the top with the most visual weight.
 * Host and history get a small tag label; the model picker is already
 * self-identifying (provider dot + "provider:name"), so it renders untagged
 * at full width to leave room for long model ids.
 */
export function ConnectionSummary({ hostName }: { hostName: string }) {
  return (
    <div className="mb-3">
      <StaticSectionHeader label="Connection" />
      <div className="space-y-1.5">
        <LabeledRow tag="Host">
          <div className="bg-background border-input flex h-8 items-center rounded-md border px-2.5">
            <span className="truncate font-mono text-[12px]">{hostName}</span>
          </div>
        </LabeledRow>
        {/* No "Model" tag: the picker button already self-identifies via its
            provider dot + "provider:name" text, and a tag here would shave
            ~50px off the row — enough to truncate long model ids. */}
        <AgentModelPicker variant="panel" />
        <ConversationHistoryRow />
      </div>
    </div>
  )
}
