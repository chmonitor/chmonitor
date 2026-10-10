'use client'

import { AlertCircleIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import type { AgentConnectionErrorView } from './agent-connection-error'

/** Actionable notice for a mapped pre-stream agent connection error. */
export function AgentConnectionErrorNotice({
  view,
}: {
  view: AgentConnectionErrorView
}) {
  return (
    <div
      role="alert"
      data-kind={view.kind}
      className="border-border bg-muted/40 mt-1 rounded-lg border px-3 py-3 text-sm"
    >
      <div className="flex items-start gap-2">
        <AlertCircleIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium break-words">{view.title}</p>
          <p className="text-muted-foreground text-xs break-words">
            {view.message}
          </p>
          {view.action ? (
            <Link
              to={view.action.to}
              className="bg-primary text-primary-foreground mt-2 inline-flex h-8 items-center rounded-md px-3 text-xs font-medium"
            >
              {view.action.label}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  )
}
