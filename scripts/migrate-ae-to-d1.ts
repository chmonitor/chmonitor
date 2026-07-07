#!/usr/bin/env bun
// One-time migration: pull historical data from Analytics Engine into D1.
//
// Prerequisites:
//   CF_ACCOUNT_ID=<cloudflare account id>
//   CF_API_TOKEN=<cloudflare api token with Analytics:Read>
//
// Usage:
//   bun scripts/migrate-ae-to-d1.ts

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID
const CF_API_TOKEN = process.env.CF_API_TOKEN
const AE_DATASET = 'chm_telemetry'
const D1_DATABASE_ID = '4887176b-0181-45bf-970f-a506f514d5a9'

if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
  console.error('Set CF_ACCOUNT_ID and CF_API_TOKEN environment variables')
  process.exit(1)
}

const AE_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/analytics_engine/sql`
const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/raw`

async function queryAE(sql: string): Promise<unknown[]> {
  const res = await fetch(AE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  const json = (await res.json()) as {
    success: boolean
    result: unknown[]
    errors?: unknown[]
  }
  if (!json.success) {
    console.error('AE query failed:', json.errors)
    return []
  }
  return json.result as unknown[]
}

async function executeD1(sql: string): Promise<void> {
  const res = await fetch(D1_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  })
  const json = (await res.json()) as { success: boolean; errors?: unknown[] }
  if (!json.success) {
    console.error('D1 execute failed:', json.errors)
  }
}

interface PingRow {
  instance_hash: string
  deploy_target: string
  ch_version: string
  ch_flavor: string
  country: string
  platform: string
  chm_version: string
  install_place: string
  timestamp: string
}

async function migratePings() {
  console.log('Migrating pings from AE...')

  const rows = await queryAE(`
    SELECT
      index1 AS instance_hash,
      blob2 AS deploy_target,
      blob3 AS ch_version,
      blob4 AS ch_flavor,
      blob5 AS country,
      blob6 AS platform,
      blob7 AS chm_version,
      blob8 AS install_place,
      toTimestamp(timestamp) AS timestamp
    FROM ${AE_DATASET}
    WHERE blob1 = 'ping'
    ORDER BY timestamp
  `)

  if (rows.length === 0) {
    console.log('No ping data found in AE')
    return
  }

  console.log(`Found ${rows.length} ping rows`)

  const deduped = new Map<string, PingRow>()
  for (const row of rows) {
    const r = row as Record<string, string>
    const day =
      r.timestamp?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
    const key = `${day}:${r.instance_hash}`
    if (!deduped.has(key)) {
      deduped.set(key, {
        instance_hash: r.instance_hash,
        deploy_target: r.deploy_target || 'unknown',
        ch_version: r.ch_version || '',
        ch_flavor: r.ch_flavor || 'unknown',
        country: r.country || 'unknown',
        platform: r.platform || 'unknown',
        chm_version: r.chm_version || '',
        install_place: r.install_place || '',
        timestamp: r.timestamp,
      })
    }
  }

  console.log(
    `Deduplicated to ${deduped.size} unique (day, instance_hash) pairs`
  )

  const batches = Array.from(deduped.values())
  const BATCH_SIZE = 50

  for (let i = 0; i < batches.length; i += BATCH_SIZE) {
    const batch = batches.slice(i, i + BATCH_SIZE)
    const values = batch
      .map((r) => {
        const day =
          r.timestamp?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
        const esc = (s: string) => s.replace(/'/g, "''")
        return `('${day}','${esc(r.instance_hash)}','${esc(r.deploy_target)}','${esc(r.ch_version)}','${esc(r.ch_flavor)}','${esc(r.country)}','${esc(r.platform)}','${esc(r.chm_version)}','${esc(r.install_place)}')`
      })
      .join(',')

    await executeD1(
      `INSERT OR IGNORE INTO ping_daily (day,instance_hash,deploy_target,ch_version,ch_flavor,country,platform,chm_version,install_place) VALUES ${values}`
    )

    console.log(
      `Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(batches.length / BATCH_SIZE)}`
    )
  }

  console.log('Ping migration complete')
}

async function migrateEvents() {
  console.log('Migrating events from AE...')

  const rows = await queryAE(`
    SELECT
      blob2 AS event_name,
      blob3 AS deploy_target,
      blob4 AS ch_version,
      blob5 AS ch_flavor,
      toTimestamp(timestamp) AS timestamp
    FROM ${AE_DATASET}
    WHERE blob1 = 'event'
    ORDER BY timestamp
  `)

  if (rows.length === 0) {
    console.log('No event data found in AE')
    return
  }

  console.log(`Found ${rows.length} event rows`)

  const BATCH_SIZE = 50

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const values = batch
      .map((row) => {
        const r = row as Record<string, string>
        const day =
          r.timestamp?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
        const esc = (s: string) => s.replace(/'/g, "''")
        return `('${day}','${esc(r.event_name)}','${esc(r.deploy_target)}','${esc(r.ch_version)}','${esc(r.ch_flavor)}')`
      })
      .join(',')

    await executeD1(
      `INSERT INTO events (day,event,deploy_target,ch_version,ch_flavor) VALUES ${values}`
    )

    console.log(
      `Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)}`
    )
  }

  console.log('Event migration complete')
}

async function main() {
  console.log('Starting AE to D1 migration...')
  console.log(`Account: ${CF_ACCOUNT_ID}`)
  console.log(`Dataset: ${AE_DATASET}`)
  console.log(`D1 Database: ${D1_DATABASE_ID}`)
  console.log('')

  await migratePings()
  console.log('')
  await migrateEvents()

  console.log('')
  console.log('Migration complete!')
  console.log('Verify with:')
  console.log(
    `  curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/raw" -H "Authorization: Bearer $CF_API_TOKEN" -d '{"sql":"SELECT COUNT(*) FROM ping_daily"}'`
  )
}

main().catch(console.error)
