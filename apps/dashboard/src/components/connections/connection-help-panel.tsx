import {
  ArrowUpRight,
  Database,
  KeyRound,
  Lock,
  MonitorSmartphone,
  Network,
  ShieldCheck,
} from 'lucide-react'

import { ChmonitorLogo } from '@/components/icons/chmonitor-logo'
import { docsSiteUrl } from '@/lib/docs-site'
import { cn } from '@/lib/utils'

/**
 * Guidance sidebar for the "Add ClickHouse host" dialog. Explains what chmonitor
 * needs to connect (a read-only `SELECT` user, a firewall allowlist), how
 * credentials are protected, and links to the same docs the form references —
 * so the operator has the requirements in view while filling in the form.
 *
 * Purely presentational (no state / no behaviour); the flow diagram and lists
 * are built from design-token divs + `lucide-react` icons.
 */
export function ConnectionHelpPanel({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        'flex flex-col gap-5 rounded-xl border bg-gradient-to-b from-muted/40 to-muted/10 p-4 text-sm dark:from-muted/20 dark:to-muted/5',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-300',
        className
      )}
    >
      <ConnectionFlowDiagram />

      <Section
        icon={<KeyRound className="size-4 text-orange-500" strokeWidth={1.5} />}
        title="What chmonitor needs"
      >
        <ul className="space-y-2 text-xs text-muted-foreground">
          <RequirementItem
            icon={
              <ShieldCheck
                className="size-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
            }
          >
            A ClickHouse user with{' '}
            <code className="text-foreground">SELECT</code> on{' '}
            <code className="text-foreground">system.*</code> — read-only is
            enough.
          </RequirementItem>
          <RequirementItem
            icon={
              <Network
                className="size-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
            }
          >
            The HTTP interface reachable from chmonitor (allowlist the Cloud
            connection in your firewall).
          </RequirementItem>
        </ul>
        <a
          href={docsSiteUrl('getting-started/clickhouse-requirements')}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
        >
          Required permissions &amp; firewall setup
          <ArrowUpRight className="size-3" />
        </a>
      </Section>

      <Section
        icon={<Lock className="size-4 text-emerald-500" strokeWidth={1.5} />}
        title="Your credentials are safe"
      >
        <p className="text-xs text-muted-foreground">
          Credentials are encrypted in this browser. Short-lived session tokens
          are used for API requests, so your password is not sent on every
          query.
        </p>
        <a
          href={docsSiteUrl('features/user-connections')}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
        >
          Sync connections across devices
          <ArrowUpRight className="size-3" />
        </a>
      </Section>
    </aside>
  )
}

/** A titled block: small icon + label heading, then arbitrary content. */
function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function RequirementItem({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="leading-relaxed">{children}</span>
    </li>
  )
}

/**
 * A compact "your browser → chmonitor → ClickHouse" flow, so operators can see
 * at a glance where the connection sits. Built from token-driven divs; the
 * connectors are an inline SVG that flips gracefully in dark mode.
 */
function ConnectionFlowDiagram() {
  return (
    <div className="rounded-lg border bg-card/60 p-3">
      <div className="flex items-center justify-between gap-1">
        <FlowNode
          label="Your browser"
          icon={
            <MonitorSmartphone
              className="size-5 text-muted-foreground"
              strokeWidth={1.5}
            />
          }
        />
        <FlowConnector />
        <FlowNode
          label="chmonitor"
          icon={<ChmonitorLogo width={20} height={20} />}
          emphasized
        />
        <FlowConnector />
        <FlowNode
          label="ClickHouse"
          icon={
            <Database
              className="size-5 text-muted-foreground"
              strokeWidth={1.5}
            />
          }
        />
      </div>
      <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
        chmonitor reads your cluster over the ClickHouse HTTP interface.
      </p>
    </div>
  )
}

function FlowNode({
  label,
  icon,
  emphasized = false,
}: {
  label: string
  icon: React.ReactNode
  emphasized?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
      <div
        className={cn(
          'flex size-10 items-center justify-center rounded-lg border bg-background',
          emphasized &&
            'border-orange-500/40 shadow-sm ring-1 ring-orange-500/10'
        )}
      >
        {icon}
      </div>
      <span className="text-[10px] font-medium text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

/**
 * A dashed connector with a subtle flow dot. The dot uses the CSS
 * `flow-dot` keyframe via `motion-safe:` so it is disabled under
 * `prefers-reduced-motion` (SMIL would ignore that preference).
 */
function FlowConnector() {
  return (
    <svg
      viewBox="0 0 40 8"
      className="h-2 w-8 shrink-0 text-border"
      fill="none"
      aria-hidden="true"
    >
      <line
        x1="1"
        y1="4"
        x2="39"
        y2="4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="3 3"
        strokeLinecap="round"
      />
      <circle
        cx="6"
        cy="4"
        r="1.75"
        className="fill-orange-500 motion-safe:animate-flow-dot"
      />
    </svg>
  )
}
