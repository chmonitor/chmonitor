/**
 * Schema Compare
 * Route: /(dashboard)/schema-diff
 *
 * Read-only table-schema compare + recommend-only change plan.
 * Copy statements only — never apply DDL.
 */

import { createFileRoute } from '@tanstack/react-router'

import { SchemaDiffPage } from '@/components/schema-diff'
import { pageOgHead } from '@/lib/og'
import { validateSchemaDiffSearch } from '@/lib/schema-diff'

export const Route = createFileRoute('/(dashboard)/schema-diff')({
  component: SchemaDiffPage,
  head: () => pageOgHead('schema-diff'),
  validateSearch: validateSchemaDiffSearch,
})
