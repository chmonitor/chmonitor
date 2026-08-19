/**
 * Settings Diff Page
 * Route: /(dashboard)/settings-diff
 *
 * Cross-host or cluster-node comparison of system.settings and
 * system.merge_tree_settings. Read-only.
 */

import { createFileRoute } from '@tanstack/react-router'

import { SettingsDiffPage } from '@/components/settings-diff/settings-diff-page'
import { pageOgHead } from '@/lib/og'
import { validateSettingsDiffSearch } from '@/lib/settings-diff/search'

export const Route = createFileRoute('/(dashboard)/settings-diff')({
  component: SettingsDiffPage,
  head: () => pageOgHead('settings-diff'),
  validateSearch: validateSettingsDiffSearch,
})
