type MonitorCoreModule = typeof import('./generated/monitor_core.js')

let modulePromise: Promise<MonitorCoreModule> | null = null

function isNodeRuntime(): boolean {
  // Cloudflare Workers with nodejs_compat polyfills process.versions.node,
  // but doesn't have a real filesystem. Must exclude Workers first.
  if (
    typeof process !== 'undefined' &&
    (process.env.CLOUDFLARE_WORKERS === '1' || process.env.CF_PAGES)
  ) {
    return false
  }
  // Runtime detection as fallback
  if (
    typeof globalThis !== 'undefined' &&
    (typeof (globalThis as any).WebSocketPair !== 'undefined' ||
      typeof (globalThis as any).DurableObject !== 'undefined') &&
    typeof process === 'undefined'
  ) {
    return false
  }
  return (
    typeof process !== 'undefined' &&
    typeof process.versions?.node === 'string' &&
    typeof process.versions?.bun === 'undefined'
  )
}

async function initMonitorCore(mod: MonitorCoreModule): Promise<void> {
  if (!isNodeRuntime()) {
    await mod.default()
    return
  }

  const [{ readFile }, { fileURLToPath }] = await Promise.all([
    import('node:fs/promises'),
    import('node:url'),
  ])
  const wasmUrl = new URL('./generated/monitor_core_bg.wasm', import.meta.url)
  const wasmBytes = await readFile(fileURLToPath(wasmUrl))

  await mod.default({ module_or_path: wasmBytes })
}

async function loadMonitorCore(): Promise<MonitorCoreModule> {
  if (!modulePromise) {
    modulePromise = import('./generated/monitor_core.js').then(async (mod) => {
      await initMonitorCore(mod)
      return mod
    })
  }

  return modulePromise
}

export async function transformClickHouseJsonEachRowWasmJson(
  input: string
): Promise<string> {
  try {
    const mod = await loadMonitorCore()
    return mod.transform_clickhouse_json_each_row_json(input)
  } catch {
    // WASM unavailable (e.g. Cloudflare Workers where import.meta.url resolves
    // to a path without origin). Fall back to pure JS parsing.
    return transformJsonEachRowFallback(input)
  }
}

/**
 * Pure JS fallback for JSONEachRow → JSON array conversion.
 * Converts numeric strings to numbers to match WASM behavior.
 */
function transformJsonEachRowFallback(input: string): string {
  if (!input.trim()) return '[]'
  const lines = input.split('\n').filter((l) => l.trim())
  const rows = lines.map((line) => {
    const obj = JSON.parse(line) as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      const val = obj[key]
      if (typeof val === 'string') {
        const num = Number(val)
        if (val.trim() !== '' && !Number.isNaN(num)) {
          obj[key] = num
        }
      }
    }
    return obj
  })
  return JSON.stringify(rows)
}

export async function transformClickHouseJsonEachRowWasm<
  T extends Record<string, unknown>,
>(input: string): Promise<T[]> {
  return JSON.parse(await transformClickHouseJsonEachRowWasmJson(input)) as T[]
}

export async function transformClickHouseDataWasm<
  T extends Record<string, unknown>,
>(input: T[]): Promise<T[]> {
  const jsonEachRow = input.map((row) => JSON.stringify(row)).join('\n')
  return transformClickHouseJsonEachRowWasm<T>(jsonEachRow)
}
