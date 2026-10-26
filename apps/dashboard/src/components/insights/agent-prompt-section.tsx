import type { InsightCard } from '@/lib/insights/types'

import { useState } from 'react'
import { CopyButton } from '@/components/mcp/copy-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  buildAgentPrompt,
  CONFIG_TARGETS,
  type ConfigTarget,
  DEFAULT_CONFIG_TARGET,
} from '@/lib/insights/agent-prompt'
import { useHostStatus } from '@/lib/swr/use-host-status'

const STORAGE_KEY = 'chm:insight-agent-config-target'

function readTarget(): ConfigTarget {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && v in CONFIG_TARGETS) return v as ConfigTarget
  } catch {}
  return DEFAULT_CONFIG_TARGET
}

/** Copyable prompt that hands this insight to the admin's own coding agent. */
export function AgentPromptSection({
  insight,
  hostId,
}: {
  insight: InsightCard
  hostId: number
}) {
  const [target, setTarget] = useState<ConfigTarget>(readTarget)
  const { data: status } = useHostStatus(hostId, { fleet: true })
  const prompt = buildAgentPrompt(insight, {
    target,
    version: status?.version,
    clusterNodes: status?.clusterNodes,
  })

  const choose = (value: ConfigTarget) => {
    setTarget(value)
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch {}
  }

  return (
    <div className="space-y-2" data-testid="insight-agent-prompt">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Fix with your coding agent
        </p>
        <CopyButton text={prompt} label="Copy prompt" />
      </div>
      <p className="text-xs text-muted-foreground">
        Paste into Claude Code, Codex or Cursor in the repo that manages this
        cluster. It asks for a reviewed change, not a direct write.
      </p>
      <Select
        value={target}
        onValueChange={(v) => v && choose(v as ConfigTarget)}
      >
        <SelectTrigger
          className="w-full sm:w-80"
          aria-label="How you apply ClickHouse changes"
        >
          <SelectValue>
            {(v: ConfigTarget) => CONFIG_TARGETS[v]?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(CONFIG_TARGETS) as ConfigTarget[]).map((key) => (
            <SelectItem key={key} value={key}>
              {CONFIG_TARGETS[key].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
        {prompt}
      </pre>
    </div>
  )
}
