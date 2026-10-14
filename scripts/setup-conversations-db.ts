#!/usr/bin/env bun

/**
 * One-time setup script for AI agent conversations D1 database.
 *
 * Usage: bun run cf:setup-conversations
 *
 * After running this script, the database is ready for use.
 * Run `bun run cf:migrate-conversations` to apply schema changes.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATABASE_NAME = 'chm-cloud'
const WRANGLER_TOML_PATH = join(process.cwd(), 'wrangler.toml')

interface WranglerD1CreateOutput {
  database_id: string
  database_name: string
}

function parseDatabaseId(output: string): string | null {
  const jsonMatch = output.match(/\{[^}]*"database_id"\s*:\s*"([^"]+)"/)
  if (jsonMatch) return jsonMatch[1]

  const uuidMatch = output.match(
    /([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i
  )
  if (uuidMatch) return uuidMatch[1]

  return null
}

function updateWranglerToml(databaseId: string): boolean {
  try {
    const content = readFileSync(WRANGLER_TOML_PATH, 'utf-8')

    const withDatabaseId = (block: string) => {
      let updated = block

      if (/^\s*database_id\s*=/m.test(updated)) {
        updated = updated.replace(
          /^\s*database_id\s*=.*$/m,
          `database_id = "${databaseId}"`
        )
      } else if (/^\s*migrations_dir\s*=/m.test(updated)) {
        updated = updated.replace(
          /^\s*migrations_dir\s*=/m,
          `database_id = "${databaseId}"\nmigrations_dir =`
        )
      } else {
        updated = `${updated}\ndatabase_id = "${databaseId}"`
      }

      if (!/^\s*migrations_dir\s*=/m.test(updated)) {
        updated = `${updated}\nmigrations_dir = "src/db/conversations-migrations"`
      }

      return updated
    }

    let matchedMain = false
    let matchedPreview = false

    const updatedMain = content.replace(
      /(# D1 database for AI agent conversations\s+\[\[d1_databases\]\]\s+binding = "CHM_CLOUD_D1"\s+database_name = "chm-cloud"(?:\s+database_id = "[^"]*")?(?:\s+migrations_dir = "[^"]*")?)/g,
      (block) => {
        matchedMain = true
        return withDatabaseId(block)
      }
    )

    const updatedPreview = updatedMain.replace(
      /(# Reuse the same conversation D1 database once database_id is provisioned\s+\[\[env\.preview\.d1_databases\]\]\s+binding = "CHM_CLOUD_D1"\s+database_name = "chm-cloud"(?:\s+database_id = "[^"]*")?(?:\s+migrations_dir = "[^"]*")?)/g,
      (block) => {
        matchedPreview = true
        return withDatabaseId(block)
      }
    )

    if (!matchedMain || !matchedPreview) {
      console.error(
        `❌ Expected CHM_CLOUD_D1 blocks were not matched in wrangler.toml for database_id ${databaseId}`
      )
      return false
    }

    writeFileSync(WRANGLER_TOML_PATH, updatedPreview, 'utf-8')
    console.log(`✅ Updated wrangler.toml with database_id: ${databaseId}`)
    return true
  } catch (error) {
    console.error(`❌ Failed to update wrangler.toml: ${error}`)
    return false
  }
}

async function createD1Database(): Promise<{
  success: boolean
  databaseId?: string
}> {
  console.log(`🔧 Creating D1 database: ${DATABASE_NAME}\n`)

  const proc = Bun.spawn(
    ['wrangler', 'd1', 'create', DATABASE_NAME, '--json'],
    {
      stdout: 'pipe',
      stderr: 'inherit',
    }
  )

  const output = await new TextDecoder().decode(proc.stdout)
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    if (
      output.includes('already exists') ||
      output.includes('already created')
    ) {
      console.log(`⚠️  Database ${DATABASE_NAME} may already exist`)
      console.log(`   Checking existing database...\n`)

      // Try to get database info
      const listProc = Bun.spawn(['wrangler', 'd1', 'list', '--json'], {
        stdout: 'pipe',
        stderr: 'inherit',
      })

      const listOutput = await new TextDecoder().decode(listProc.stdout)
      await listProc.exited

      try {
        const databases = JSON.parse(listOutput) as Array<{
          name: string
          uuid: string
        }>
        const existing = databases.find((db) => db.name === DATABASE_NAME)

        if (existing) {
          console.log(`✅ Found existing database: ${existing.uuid}`)
          return { success: true, databaseId: existing.uuid }
        }
      } catch {
        // Fall through to error
      }

      console.error(
        `❌ Failed to create database and couldn't find existing one`
      )
      console.error(`Output: ${output}`)
      return { success: false }
    }

    console.error(`❌ Failed to create D1 database`)
    console.error(`Exit code: ${exitCode}`)
    console.error(`Output: ${output}`)
    return { success: false }
  }

  let databaseId: string | null = null

  try {
    const jsonResponse = JSON.parse(output) as
      | WranglerD1CreateOutput
      | { error?: string }
    if ('database_id' in jsonResponse) {
      databaseId = jsonResponse.database_id
    } else if ('error' in jsonResponse) {
      throw new Error(jsonResponse.error)
    }
  } catch {
    databaseId = parseDatabaseId(output)
  }

  if (!databaseId) {
    console.error(`❌ Could not extract database_id from wrangler output`)
    console.error(`Output: ${output}`)
    return { success: false }
  }

  console.log(`✅ Created D1 database: ${DATABASE_NAME}`)
  console.log(`   Database ID: ${databaseId}\n`)

  return { success: true, databaseId }
}

async function runMigrations(): Promise<boolean> {
  console.log(`🔄 Running database migrations...\n`)

  const proc = Bun.spawn(
    [
      'wrangler',
      'd1',
      'migrations',
      'apply',
      DATABASE_NAME,
      '--remote',
      '--yes',
    ],
    {
      stdout: 'inherit',
      stderr: 'inherit',
    }
  )

  const exitCode = await proc.exited

  if (exitCode !== 0) {
    console.error(`❌ Failed to run migrations (exit code: ${exitCode})`)
    return false
  }

  console.log(`\n✅ Migrations applied successfully`)
  return true
}

async function main() {
  console.log(`╔════════════════════════════════════════════════════════════╗`)
  console.log(`║  AI Agent Conversations D1 Database - One-Time Setup        ║`)
  console.log(`╚════════════════════════════════════════════════════════════╝`)
  console.log()

  const createResult = await createD1Database()
  if (!createResult.success || !createResult.databaseId) {
    console.error(`\n❌ Setup failed. Please check the errors above.`)
    console.error(`\nManual setup steps:`)
    console.error(`  1. Run: wrangler d1 create ${DATABASE_NAME}`)
    console.error(`  2. Copy the database_id from the output`)
    console.error(
      `  3. Add to wrangler.toml under [[d1_databases]] for CHM_CLOUD_D1:`
    )
    console.error(`     database_id = "<your-database-id>"`)
    process.exit(1)
  }

  const updated = updateWranglerToml(createResult.databaseId!)
  if (!updated) {
    console.error(
      `\n❌ Failed to update wrangler.toml. Please update manually:`
    )
    console.error(
      `   Add database_id = "${createResult.databaseId}" to the CHM_CLOUD_D1 section`
    )
    process.exit(1)
  }

  const migrated = await runMigrations()
  if (!migrated) {
    console.warn(`\n⚠️  Database created but migrations failed.`)
    console.warn(`   Run migrations manually: bun run cf:migrate-conversations`)
    process.exit(1)
  }

  console.log()
  console.log(`╔════════════════════════════════════════════════════════════╗`)
  console.log(
    `║  ✅ Setup Complete!                                          ║`
  )
  console.log(`╠════════════════════════════════════════════════════════════╣`)
  console.log(`║  Database: ${DATABASE_NAME.padEnd(47)}║`)
  console.log(`║  Database ID: ${createResult.databaseId!.padEnd(42)}║`)
  console.log(`╠════════════════════════════════════════════════════════════╣`)
  console.log(`║  Next Steps:                                                ║`)
  console.log(`║  1. Set AGENT_CONVERSATION_PERSISTENCE=true                 ║`)
  console.log(`║  2. Set AGENT_CONVERSATION_STORE=d1                         ║`)
  console.log(
    `║  3. Set auth provider: NEXT_PUBLIC_AUTH_PROVIDER=clerk       ║`
  )
  console.log(
    `║  4. Deploy: bun run cf:deploy                                ║`
  )
  console.log(
    `║  5. Test the /agents page with conversation persistence       ║`
  )
  console.log(`╚════════════════════════════════════════════════════════════╝`)
}

main().catch((error) => {
  console.error(`\n❌ Unexpected error: ${error}`)
  process.exit(1)
})
