#!/usr/bin/env bun

/**
 * CLI tool to generate ClickHouse schema documentation
 *
 * Usage:
 *   bun run scripts/build-ch-schema-docs.ts
 *   bun run scripts/build-ch-schema-docs.ts --version 24.1
 *   bun run scripts/build-ch-schema-docs.ts --table query_log
 *   bun run scripts/build-ch-schema-docs.ts --verbose
 *   bun run scripts/build-ch-schema-docs.ts --live  (clickhouse local; CH_LOCAL_BIN overrides the binary)
 */

import type { CLIOptions } from './ch-schema/types'

import { fetchChangelog } from './ch-schema/changelog-fetcher'
import { parseChangelog } from './ch-schema/changelog-parser'
import { DEFAULT_OUTPUT_DIR } from './ch-schema/constants'
import { generateDocs } from './ch-schema/docs-generator'
import { clickhouseLocalQuery, generateLiveDocs } from './ch-schema/live-docs'
import { parseArgs } from 'node:util'

async function main() {
  console.log('ClickHouse Schema Documentation Generator\n')

  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      version: { type: 'string', short: 'v' },
      table: { type: 'string', short: 't' },
      output: { type: 'string', short: 'o', default: DEFAULT_OUTPUT_DIR },
      verbose: { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
    },
  })

  const options: CLIOptions = {
    version: values.version,
    table: values.table,
    output: (values.output as string) || DEFAULT_OUTPUT_DIR,
    verbose: values.verbose as boolean,
  }

  try {
    if (values.live) {
      await generateLiveDocs(
        clickhouseLocalQuery(process.env.CH_LOCAL_BIN),
        options.output
      )
      return
    }

    const changelog = await fetchChangelog()

    console.log('\nParsing changelog...')
    let entries = parseChangelog(changelog)

    if (options.version) {
      entries = entries.filter((e) => e.version === options.version)
      console.log(
        `Filtered to version ${options.version}: ${entries.length} entries`
      )
    }

    console.log('\nGenerating documentation...')
    await generateDocs(entries, options.output)

    console.log('\n✓ Documentation generated successfully!')
    console.log(`   Output: ${options.output}/`)
  } catch (error) {
    console.error('\n✗ Error:', error)
    process.exit(1)
  }
}

main()
