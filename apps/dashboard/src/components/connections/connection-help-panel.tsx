import {
  ArrowUpRight,
  Database,
  KeyRound,
  Lock,
  MonitorSmartphone,
  Network,
  Server,
  ShieldCheck,
} from 'lucide-react'

import type { SourceEngine } from '@chm/types'
import type { ComponentType } from 'react'

import { ChmonitorLogo } from '@/components/icons/chmonitor-logo'
import { docsSiteUrl } from '@/lib/docs-site'
import { cn } from '@/lib/utils'

/** Whether the panel should render its Postgres variant. */
function isPostgresEngine(engine: SourceEngine): boolean {
  return engine === 'postgres'
}

/**
 * Per-engine styling + copy for the help panel. Kept as full class strings (no
 * dynamic interpolation) so Tailwind's scanner keeps them, and driven by design
 * tokens / Tailwind palette utilities — never hardcoded hex. `transition-colors`
 * on the tinted elements animates the swap when the user switches the tab.
 */
const ENGINE_UI: Record<
  'clickhouse' | 'postgres',
  {
    label: string
    Icon: ComponentType<{ className?: string; strokeWidth?: number }>
    /** flow-dot fill + emphasized-node ring accent */
    dotFill: string
    ring: string
    flowNote: string
  }
> = {
  clickhouse: {
    label: 'ClickHouse',
    Icon: Database,
    dotFill: 'fill-orange-500',
    ring: 'border-orange-500/40 ring-orange-500/10',
    flowNote:
      'chmonitor reads your cluster over the ClickHouse HTTP interface.',
  },
  postgres: {
    label: 'Postgres',
    Icon: Server,
    dotFill: 'fill-sky-500',
    ring: 'border-sky-500/40 ring-sky-500/10',
    flowNote:
      'chmonitor reads your database over a read-only Postgres connection.',
  },
}

/**
 * Guidance sidebar for the Add-host dialog. Explains what chmonitor needs to
 * connect, how credentials are protected, and links to the same docs the form
 * references — so the operator has the requirements in view while filling in
 * the form. Engine-aware: the flow diagram, requirements list and accent tint
 * switch between ClickHouse and Postgres.
 *
 * Purely presentational (no state / no behaviour); the flow diagram and lists
 * are built from design-token divs + `lucide-react` icons.
 */
export function ConnectionHelpPanel({
  className,
  engine = 'clickhouse',
}: {
  className?: string
  /** Active source engine — defaults to ClickHouse (fail-closed). */
  engine?: SourceEngine
}) {
  const postgres = isPostgresEngine(engine)
  const ui = postgres ? ENGINE_UI.postgres : ENGINE_UI.clickhouse

  return (
    <aside
      className={cn(
        'flex flex-col gap-5 rounded-xl border bg-gradient-to-b from-muted/40 to-muted/10 p-4 text-sm dark:from-muted/20 dark:to-muted/5',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-300',
        className
      )}
    >
      <ConnectionFlowDiagram ui={ui} />

      <Section
        icon={<KeyRound className="size-4 text-orange-500" strokeWidth={1.5} />}
        title="What chmonitor needs"
      >
        <ul className="space-y-2 text-xs text-muted-foreground">
          {postgres ? (
            <>
              <RequirementItem
                icon={
                  <ShieldCheck
                    className="size-3.5 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                }
              >
                A read-only Postgres user — monitoring only runs{' '}
                <code className="text-foreground">SELECT</code> against{' '}
                <code className="text-foreground">pg_stat_*</code> views.
              </RequirementItem>
              <RequirementItem
                icon={
                  <Network
                    className="size-3.5 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                }
              >
                The Postgres port (default{' '}
                <code className="text-foreground">5432</code>) reachable from
                chmonitor. Behind a firewall? Cloud has no fixed IP —{' '}
                <FirewallGuideLink />.
              </RequirementItem>
              <RequirementItem
                icon={
                  <Lock
                    className="size-3.5 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                }
              >
                An <code className="text-foreground">sslmode</code> that matches
                your server (<code className="text-foreground">require</code> is
                the safe default).
              </RequirementItem>
              <RequirementItem
                icon={
                  <Database
                    className="size-3.5 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                }
              >
                <code className="text-foreground">pg_stat_statements</code>{' '}
                enabled (optional) unlocks the query-insight views.
              </RequirementItem>
            </>
          ) : (
            <>
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
                The HTTP interface reachable from chmonitor. Behind a firewall?
                Cloud has no fixed IP — <FirewallGuideLink />.
              </RequirementItem>
            </>
          )}
        </ul>
        <a
          href={docsSiteUrl(
            postgres
              ? 'getting-started'
              : 'getting-started/clickhouse-requirements'
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
        >
          {postgres
            ? 'Postgres monitoring setup'
            : 'Required permissions & firewall setup'}
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

/**
 * Answers "what IP do I allowlist?" inline: Cloud runs on Cloudflare Workers
 * with no fixed egress IP, so the guide (Tunnel / dedicated egress / static
 * proxy) is the real answer — never Cloudflare's shared public ranges.
 */
function FirewallGuideLink() {
  return (
    <a
      href={docsSiteUrl('guides/connect-firewalled-clickhouse')}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-foreground underline-offset-2 hover:underline"
    >
      see the firewall guide
    </a>
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
 * A compact "your browser → chmonitor → source" flow, so operators can see at a
 * glance where the connection sits. Built from token-driven divs; the
 * connectors are an inline SVG that flips gracefully in dark mode. The third
 * node + flow-dot accent follow the active engine.
 */
function ConnectionFlowDiagram({
  ui,
}: {
  ui: (typeof ENGINE_UI)[keyof typeof ENGINE_UI]
}) {
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
        <FlowConnector dotFill={ui.dotFill} />
        <FlowNode
          label="chmonitor"
          icon={<ChmonitorLogo width={20} height={20} />}
          emphasized
          ring={ui.ring}
        />
        <FlowConnector dotFill={ui.dotFill} />
        <FlowNode
          label={ui.label}
          icon={
            <ui.Icon
              className="size-5 text-muted-foreground"
              strokeWidth={1.5}
            />
          }
        />
      </div>
      <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
        {ui.flowNote}
      </p>
    </div>
  )
}

function FlowNode({
  label,
  icon,
  emphasized = false,
  ring,
}: {
  label: string
  icon: React.ReactNode
  emphasized?: boolean
  /** Accent classes for the emphasized (chmonitor) node — engine-tinted. */
  ring?: string
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
      <div
        className={cn(
          'flex size-10 items-center justify-center rounded-lg border bg-background transition-colors',
          emphasized && cn('shadow-sm ring-1', ring)
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
 * `prefers-reduced-motion` (SMIL would ignore that preference). Its fill is
 * engine-tinted and animates on engine switch via `transition-colors`.
 */
function FlowConnector({ dotFill }: { dotFill: string }) {
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
        className={cn(
          dotFill,
          'transition-colors motion-safe:animate-flow-dot'
        )}
      />
    </svg>
  )
}
