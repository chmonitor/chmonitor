import { describe, expect, it } from 'bun:test'
import {
  buildAgentPrompt,
  CONFIG_TARGETS,
  type ConfigTarget,
} from '@/lib/insights/agent-prompt'

const insight = {
  severity: 'warning' as const,
  category: 'storage',
  title: 'Too many parts in db.events',
  detail: 'db.events has 2,400 active parts.',
  metric: 'parts_count',
  value: 2400,
}

describe('buildAgentPrompt', () => {
  it('carries the finding so the agent can act without the dashboard', () => {
    const p = buildAgentPrompt(insight, {
      target: 'config-files',
      version: '25.8.1.1',
    })
    expect(p).toContain('Too many parts in db.events')
    expect(p).toContain('db.events has 2,400 active parts.')
    expect(p).toContain('parts_count = 2400')
    expect(p).toContain('25.8.1.1')
  })

  it('gives each way of applying changes its own guidance', () => {
    const prompts = (Object.keys(CONFIG_TARGETS) as ConfigTarget[]).map(
      (target) => buildAgentPrompt(insight, { target })
    )
    expect(new Set(prompts).size).toBe(prompts.length)
    expect(buildAgentPrompt(insight, { target: 'clickhouse-cloud' })).toContain(
      'config files are not editable'
    )
  })

  it('asks for ON CLUSTER only when there is more than one node', () => {
    expect(
      buildAgentPrompt(insight, { target: 'sql-only', clusterNodes: 3 })
    ).toContain('ON CLUSTER')
    expect(
      buildAgentPrompt(insight, { target: 'sql-only', clusterNodes: 1 })
    ).not.toContain('ON CLUSTER')
  })

  it('tells the agent to check the version when it is unknown', () => {
    expect(buildAgentPrompt(insight, { target: 'helm' })).toContain(
      'SELECT version()'
    )
  })

  it('never asks the agent to write to the cluster directly', () => {
    expect(buildAgentPrompt(insight, { target: 'config-files' })).toContain(
      'Do not run anything that writes to the cluster yourself'
    )
  })
})
