import { GearIcon, TableIcon } from '@radix-ui/react-icons'
import {
  BellRingIcon,
  CalendarClockIcon,
  SlidersHorizontalIcon,
} from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const settingsItems: MenuItem[] = [
  {
    // Configuration pages, kept out of the task groups so those list only
    // things to look at. Dashboard-side settings first (agent, insights,
    // reports, health, alerts), then read-only server settings. No
    // `permission` on the parent: each child keeps the gate it had in its
    // old group (`agent`, `insights`, `health`, `settings`, none).
    title: 'Settings',
    href: '',
    icon: GearIcon,
    section: 'others',
    items: [
      {
        title: 'Agent Settings',
        href: '/agents/settings',
        description:
          'Provider, model, system prompt, skills, and external MCP servers',
        icon: SlidersHorizontalIcon,
        permission: { feature: 'agent' },
      },
      {
        title: 'Insights Settings',
        href: '/insights-settings',
        description:
          'Configure how insights are generated — templates, AI enhancement, model, and prompt style',
        icon: SlidersHorizontalIcon,
        isNew: true,
        permission: { feature: 'insights' },
      },
      {
        title: 'Scheduled Reports',
        href: '/report-settings',
        description:
          'Weekly or monthly cluster health reports, delivered to your alert channels',
        icon: CalendarClockIcon,
        isNew: true,
        // Subscriptions persist in the metadata DB (report-subscription-store);
        // dimmed when the deployment has no D1/Postgres configured. Config-gated
        // items stay DISCOVERABLE by design (#3463) — a self-hoster who adds D1
        // later should still find the page — so no `hideWhenUnavailable` here.
        requiresMetadataDb: true,
        permission: { feature: 'insights' },
      },
      {
        title: 'Health Settings',
        href: '/health-settings',
        description:
          'Per-check warning and critical thresholds for health monitoring',
        icon: SlidersHorizontalIcon,
        isNew: true,
        permission: { feature: 'health' },
      },
      {
        // /health?settings=alerts redirects here for old links.
        title: 'Alert Settings',
        href: '/alert-settings',
        description:
          'Alert channels, webhooks, routing, quiet hours, digests and alert history',
        icon: BellRingIcon,
        isNew: true,
        permission: { feature: 'health' },
      },
      {
        title: 'Settings',
        href: '/settings',
        description: 'Server configuration settings and current values',
        countKey: 'settings',
        countLabel: 'settings',
        icon: GearIcon,
        permission: { feature: 'settings' },
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/settings',
        tableCheck: 'system.settings',
      },
      {
        title: 'MergeTree Settings',
        href: '/mergetree-settings',
        description: 'MergeTree engine-specific settings',
        countKey: 'mergetree-settings',
        countLabel: 'settings',
        icon: TableIcon,
        permission: { feature: 'settings' },
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/merge_tree_settings',
        tableCheck: 'system.merge_tree_settings',
      },
      {
        title: 'Replicated MergeTree Settings',
        href: '/replicated-merge-tree-settings',
        description:
          'Replicated MergeTree engine settings and whether each was changed from default',
        icon: SlidersHorizontalIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/replicated_merge_tree_settings',
        tableCheck: 'system.replicated_merge_tree_settings',
      },
    ],
  },
]
