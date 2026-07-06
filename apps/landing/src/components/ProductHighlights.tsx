import { Bell, Bot, Database, LineChart } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import '@/styles/globals.css'

const HIGHLIGHTS = [
  {
    icon: LineChart,
    title: 'Live system tables',
    body: 'Queries, merges, parts and replication — polled from your cluster with version-aware SQL and graceful empty states.',
  },
  {
    icon: Bot,
    title: 'AI agent + MCP',
    body: '29 tools across schema, diagnostics and optimization. Connect external MCP servers. Read-only by default.',
  },
  {
    icon: Bell,
    title: 'Alerting adapters',
    body: 'Compound rules, maintenance windows, Opsgenie, PagerDuty, Slack and email — routed per host or rule.',
  },
  {
    icon: Database,
    title: 'Self-host or cloud',
    body: 'Docker, Kubernetes, Cloudflare Workers or dash.chmonitor.dev. One codebase, your data stays yours on OSS.',
  },
]

export default function ProductHighlights() {
  return (
    <section id="highlights" className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-xl">
          <p className="font-medium text-primary text-sm">
            Built for operators
          </p>
          <h2 className="mt-2 font-semibold text-2xl tracking-tight sm:text-3xl">
            Everything in one pane of glass
          </h2>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HIGHLIGHTS.map((item) => (
            <Card key={item.title} className="border-border/70">
              <CardHeader className="pb-2">
                <div className="mb-2 inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground">
                  <item.icon className="size-4" strokeWidth={1.5} />
                </div>
                <CardTitle className="text-base">{item.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {item.body}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
