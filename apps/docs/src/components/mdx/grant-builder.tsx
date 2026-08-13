'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'

import { useState } from 'react'
import { copyToClipboard } from '@/lib/clipboard'

/* ------------------------------------------------------------------ */
/* Feature definitions                                                  */
/* ------------------------------------------------------------------ */

interface Feature {
  id: string
  name: string
  description: string
  always?: boolean
  requires?: string
}

const FEATURES: Feature[] = [
  {
    id: 'base',
    name: 'Basic read-only',
    description:
      'All monitoring dashboards — queries, merges, replicas, metrics',
    always: true,
  },
  {
    id: 'explorer',
    name: 'Data Explorer',
    description: 'Query any table in any database, not just system tables',
  },
  {
    id: 'actions',
    name: 'Actions (Kill Query · Optimize Table)',
    description:
      'Let operators kill running queries and optimize tables from the UI',
  },
  {
    id: 'ai_agent',
    name: 'AI Agent control tools',
    description:
      'Let the AI agent kill queries and optimize tables (also requires AGENT_ENABLE_CONTROL_TOOLS=true)',
    requires: 'actions',
  },
]

/* ------------------------------------------------------------------ */
/* Code generators                                                      */
/* ------------------------------------------------------------------ */

function buildSQL(enabled: Set<string>): string {
  const lines: string[] = [
    `CREATE USER monitoring`,
    `  IDENTIFIED WITH sha256_password BY 'your-password'`,
    `  HOST ANY;`,
    ``,
  ]

  if (enabled.has('explorer')) {
    lines.push(`-- SELECT ON *.* covers system.* and every user database`)
    lines.push(`GRANT SELECT ON *.* TO monitoring;`)
  } else {
    lines.push(`-- System tables (metrics, queries, merges, replicas, …)`)
    lines.push(`GRANT SELECT ON system.* TO monitoring;`)
  }

  lines.push(`-- Required for some merge-aware queries`)
  lines.push(`GRANT CREATE TEMPORARY TABLE ON *.* TO monitoring;`)

  if (enabled.has('actions')) {
    lines.push(``)
    lines.push(`-- Kill Query action (Running Queries page / AI agent)`)
    lines.push(`GRANT KILL QUERY ON *.* TO monitoring;`)
    lines.push(`-- Optimize Table action (Data Explorer page / AI agent)`)
    lines.push(`GRANT OPTIMIZE ON *.* TO monitoring;`)
  }

  if (enabled.has('ai_agent')) {
    lines.push(``)
    lines.push(`-- Also set this env var in your chmonitor deployment:`)
    lines.push(`-- AGENT_ENABLE_CONTROL_TOOLS=true`)
  }

  return lines.join('\n')
}

function buildXML(enabled: Set<string>): string {
  const grants: string[] = []

  if (enabled.has('explorer')) {
    grants.push(
      `        <!-- SELECT ON *.* covers system.* and every user database -->`
    )
    grants.push(`        <query>GRANT SELECT ON *.*</query>`)
  } else {
    grants.push(
      `        <!-- System tables (metrics, queries, merges, replicas, …) -->`
    )
    grants.push(`        <query>GRANT SELECT ON system.*</query>`)
  }

  grants.push(`        <!-- Required for some merge-aware queries -->`)
  grants.push(`        <query>GRANT CREATE TEMPORARY TABLE ON *.*</query>`)

  if (enabled.has('actions')) {
    grants.push(`        <!-- Kill Query + Optimize Table actions -->`)
    grants.push(`        <query>GRANT KILL QUERY ON *.*</query>`)
    grants.push(`        <query>GRANT OPTIMIZE ON *.*</query>`)
  }

  const lines = [
    `<!-- /etc/clickhouse-server/users.d/monitoring.xml -->`,
    `<!-- Generate hash: echo -n 'your-password' | sha256sum -->`,
    `<clickhouse>`,
    `  <users>`,
    `    <monitoring>`,
    `      <password_sha256_hex>REPLACE_WITH_SHA256_OF_YOUR_PASSWORD</password_sha256_hex>`,
    `      <networks><ip>::/0</ip></networks>`,
    `      <profile>monitoring_profile</profile>`,
    `      <grants>`,
    ...grants,
    `      </grants>`,
    `    </monitoring>`,
    `  </users>`,
    `</clickhouse>`,
  ]

  if (enabled.has('ai_agent')) {
    lines.push(``)
    lines.push(
      `<!-- Also set in your chmonitor deployment: AGENT_ENABLE_CONTROL_TOOLS=true -->`
    )
  }

  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* Minimal syntax colouring — no external deps                         */
/* ------------------------------------------------------------------ */

function colourSQL(raw: string): string {
  const SQL_KEYWORDS =
    /\b(CREATE|USER|IDENTIFIED|WITH|BY|HOST|ANY|GRANT|ON|TO|SELECT|TEMPORARY|TABLE|KILL|QUERY|OPTIMIZE)\b/g

  return raw
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('--')) {
        return `<span class="ch-comment">${escape(line)}</span>`
      }
      let out = escape(line)
      out = out.replace(SQL_KEYWORDS, '<span class="ch-kw">$1</span>')
      out = out.replace(/(&#39;[^&#]*&#39;)/g, '<span class="ch-str">$1</span>')
      return out
    })
    .join('\n')
}

function colourXML(raw: string): string {
  return raw
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart()
      if (trimmed.startsWith('<!--') || trimmed.endsWith('-->')) {
        return `<span class="ch-comment">${escape(line)}</span>`
      }
      let out = escape(line)
      // XML tags
      out = out.replace(
        /(&lt;\/?[\w_:.-]+(?:\s[^&gt;]*)?\/?&gt;)/g,
        '<span class="ch-tag">$1</span>'
      )
      return out
    })
    .join('\n')
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')
}

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

export function GrantBuilder() {
  const [enabled, setEnabled] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'sql' | 'xml'>('sql')
  const [copied, setCopied] = useState(false)

  function toggle(id: string) {
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        if (id === 'actions') next.delete('ai_agent')
      } else {
        next.add(id)
        if (id === 'ai_agent') next.add('actions')
      }
      return next
    })
  }

  const code = mode === 'sql' ? buildSQL(enabled) : buildXML(enabled)

  async function copy() {
    const success = await copyToClipboard(code)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const highlighted = mode === 'sql' ? colourSQL(code) : colourXML(code)

  return (
    <div className="my-6 overflow-hidden rounded-xl border border-fd-border bg-fd-card">
      {/* ── Feature toggles ── */}
      <div className="border-b border-fd-border px-4 py-3">
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-fd-muted-foreground">
          Select features
        </p>
        <div className="space-y-2">
          {FEATURES.map((f) => {
            const isOn = !!f.always || enabled.has(f.id)
            const isLocked = !!f.always
            return (
              <label
                key={f.id}
                className={[
                  'flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 transition-colors',
                  isLocked
                    ? 'cursor-default opacity-60'
                    : isOn
                      ? 'bg-fd-primary/5 hover:bg-fd-primary/10'
                      : 'hover:bg-fd-muted/50',
                ].join(' ')}
              >
                {/* custom checkbox */}
                <div className="relative mt-0.5 shrink-0">
                  <input
                    type="checkbox"
                    checked={isOn}
                    disabled={isLocked}
                    onChange={() => !isLocked && toggle(f.id)}
                    className="sr-only"
                  />
                  <div
                    className={[
                      'flex size-[18px] items-center justify-center rounded-[5px] border-2 transition-colors',
                      isOn
                        ? 'border-fd-primary bg-fd-primary'
                        : 'border-fd-border bg-fd-background',
                    ].join(' ')}
                  >
                    {isOn && (
                      <CheckIcon
                        className="size-2.5 text-fd-primary-foreground"
                        strokeWidth={3}
                      />
                    )}
                  </div>
                </div>

                {/* label text */}
                <div className="min-w-0">
                  <span className="block text-sm font-medium leading-snug text-fd-foreground">
                    {f.name}
                    {f.requires && (
                      <span className="ml-1.5 text-[10px] font-normal text-fd-muted-foreground">
                        (requires Actions)
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-fd-muted-foreground">
                    {f.description}
                  </span>
                </div>
              </label>
            )
          })}
        </div>
      </div>

      {/* ── SQL / XML toggle + Copy ── */}
      <div className="flex items-center justify-between border-b border-fd-border bg-fd-muted/30 px-3 py-1.5">
        <div className="flex gap-0.5 rounded-md bg-fd-muted p-0.5">
          {(['sql', 'xml'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={[
                'rounded px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors',
                mode === m
                  ? 'bg-fd-background text-fd-foreground shadow-sm'
                  : 'text-fd-muted-foreground hover:text-fd-foreground',
              ].join(' ')}
            >
              {m}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-fd-muted-foreground transition-colors hover:bg-fd-muted hover:text-fd-foreground"
        >
          {copied ? (
            <CheckIcon
              className="size-3.5 text-emerald-500"
              strokeWidth={2.5}
            />
          ) : (
            <CopyIcon className="size-3.5" strokeWidth={2} />
          )}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* ── Code output ── */}
      <style>{`
        .grant-code .ch-comment { color: var(--fd-muted-foreground); font-style: italic; }
        .grant-code .ch-kw      { color: var(--fd-primary); font-weight: 600; }
        .grant-code .ch-str     { color: #22c55e; }
        .grant-code .ch-tag     { color: var(--fd-primary); }
        :is(.dark) .grant-code .ch-str { color: #4ade80; }
      `}</style>
      <pre className="grant-code overflow-x-auto bg-fd-background p-4 text-[13px] leading-relaxed">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  )
}
