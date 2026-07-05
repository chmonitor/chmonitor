import { BookOpen, ExternalLink, Server, Shield, Zap } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'
import packageInfo from '@/package.json'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

const GITHUB_REPO =
  packageInfo.repository?.url || 'https://github.com/chmonitor/chmonitor'
const LICENSE = 'MIT'

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType
  title: string
  description: string
}) {
  return (
    <div className="flex gap-3">
      <div className="bg-primary/10 flex size-10 shrink-0 items-center justify-center rounded-lg">
        <Icon className="text-primary size-5" />
      </div>
      <div className="min-w-0 space-y-1">
        <h3 className="font-medium">{title}</h3>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
    </div>
  )
}

function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 flex size-12 items-center justify-center rounded-xl">
            <Server className="text-primary size-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">chmonitor</h1>
            <p className="text-muted-foreground text-sm">
              Monitoring Dashboard • v{packageInfo.version}
            </p>
          </div>
        </div>
        <p className="text-muted-foreground">{packageInfo.description}</p>
      </div>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Key Features</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <FeatureCard
            icon={Zap}
            title="Real-time Monitoring"
            description="Monitor queries, merges, mutations, and system metrics in real-time using ClickHouse system tables."
          />
          <FeatureCard
            icon={Shield}
            title="Multi-host Support"
            description="Connect to and monitor multiple ClickHouse clusters from a single dashboard interface."
          />
          <FeatureCard
            icon={BookOpen}
            title="Query Insights"
            description="Analyze running and historical queries, identify bottlenecks, and optimize performance."
          />
          <FeatureCard
            icon={Server}
            title="System Overview"
            description="View tables, replicas, disks, clusters, and ZooKeeper status at a glance."
          />
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Technology Stack</h2>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">TanStack Start</Badge>
          <Badge variant="secondary">React 19</Badge>
          <Badge variant="secondary">TypeScript</Badge>
          <Badge variant="secondary">Vite</Badge>
          <Badge variant="secondary">Tailwind CSS 4</Badge>
          <Badge variant="secondary">shadcn/ui</Badge>
          <Badge variant="secondary">ClickHouse</Badge>
          <Badge variant="secondary">TanStack Query</Badge>
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Open Source</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ExternalLink className="size-5" />
                Source Code
              </CardTitle>
              <CardDescription>
                Contribute, report issues, or star the project on GitHub
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                render={
                  <a
                    href={GITHUB_REPO.replace('git+', '').replace('.git', '')}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 size-4" />
                    View Repository
                  </a>
                }
              />
            </CardContent>
          </Card>

          <Card className="group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="size-5" />
                Documentation
              </CardTitle>
              <CardDescription>
                Learn how to configure and use the monitoring dashboard
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                render={
                  <a
                    href={`${GITHUB_REPO.replace('git+', '').replace('.git', '')}#readme`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <BookOpen className="mr-2 size-4" />
                    Read Docs
                  </a>
                }
              />
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      {/* Build Information - Only show in production builds */}
      {import.meta.env.VITE_CI && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Build Information</h2>
          <Card>
            <CardContent className="pt-6">
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Git Commit */}
                <div className="space-y-1">
                  <p className="text-muted-foreground text-sm font-medium">
                    Git Commit
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="bg-muted rounded px-2 py-1 text-sm font-mono">
                      {import.meta.env.VITE_GIT_SHA?.slice(0, 7)}
                    </code>
                    {import.meta.env.VITE_GIT_SHA && (
                      <a
                        href={`${GITHUB_REPO.replace('git+', '').replace('.git', '')}/commit/${import.meta.env.VITE_GIT_SHA}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground text-sm"
                        aria-label="View commit on GitHub"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Branch/Tag */}
                <div className="space-y-1">
                  <p className="text-muted-foreground text-sm font-medium">
                    Branch / Tag
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-xs">
                      {import.meta.env.VITE_GIT_REF}
                    </Badge>
                  </div>
                </div>

                {/* Build Timestamp */}
                <div className="space-y-1 sm:col-span-2">
                  <p className="text-muted-foreground text-sm font-medium">
                    Build Time
                  </p>
                  <p className="text-sm">
                    {import.meta.env.VITE_BUILD_TIMESTAMP
                      ? new Date(
                          import.meta.env.VITE_BUILD_TIMESTAMP
                        ).toLocaleString('en-US', {
                          dateStyle: 'long',
                          timeStyle: 'medium',
                          timeZone: 'UTC',
                        })
                      : 'Unknown'}{' '}
                    <span className="text-muted-foreground">(UTC)</span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      <Separator />

      <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
        <p>
          Released under the <Badge variant="outline">{LICENSE}</Badge> License
        </p>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/(dashboard)/about')({
  component: AboutPage,
})
