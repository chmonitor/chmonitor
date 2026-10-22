/**
 * Exhaustive check of the agent's tool-gate invariants over every request
 * shape in a finite domain, run against the REAL composition the agent route
 * uses: resolveControlToolsEnabled() → the route's `actions` permission AND →
 * createClickHouseAgent() → createAllTools() (env kill switches, integration
 * gates, search_tools bound last, connection binding) → filterTools()
 * (`disabledTools`) → the map ToolLoopAgent actually receives (`agent.tools`).
 *
 * Owned by `.claude/skills/verify-agent-tool-gates/SKILL.md` — read it before
 * changing this file. Properties:
 *
 *   W  write safety: a destructive control tool is callable only when the
 *      resolver allowed it, the actions permission passed, the env kill switch
 *      is not off, it is not in disabledTools, and no user connection is bound
 *      (bound → its execute refuses). An anonymous cloud caller never gets one.
 *   L  liveness: an OSS caller with no anonymity (auth none/trusted/proxy, or
 *      Clerk signed in), flag unset, actions allowed, gets all three. Keeps W
 *      from passing on a map that simply never contains control tools.
 *   I  integration safety: Postgres / PeerDB tools appear only when their
 *      integration gate is on and the env kill switches are not off.
 *   S  search honesty: the set search_tools reports as callable equals the set
 *      of catalog tools in the final map, and its count equals the map size.
 *
 * S is split: with no disabledTools it must hold; with disabledTools it is a
 * KNOWN FINDING (search_tools is bound before filterTools runs, so it still
 * advertises a disabled tool). That case is `test.failing` so this file stays
 * green and flips red the day the finding is fixed.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { MockLanguageModelV3 } from 'ai/test'

mock.module('server-only', () => ({}))
mock.module('@chm/clickhouse-client', () => ({
  getClient: async () => ({
    command: async () => ({}),
    insert: async () => ({}),
    query: async () => ({ json: async () => [] }),
  }),
  fetchData: async () => ({ data: [], error: null }),
}))

const { createClickHouseAgent } = await import('../clickhouse-agent')
const { resolveControlToolsEnabled } = await import('../control-tools-gate')
const { TOOL_CATALOG } = await import('../tools/catalog')
const { AUTH_PROVIDERS } = await import('@/lib/auth/auth-providers')
const { parseBool } = await import('@/lib/config/parse-bool')

const CONTROL = ['kill_query', 'optimize_table', 'kill_mutation']
const POSTGRES = Object.keys(TOOL_CATALOG).filter(
  (n) => TOOL_CATALOG[n].category === 'postgres'
)
const PEERDB = Object.keys(TOOL_CATALOG).filter(
  (n) => TOOL_CATALOG[n].category === 'peerdb'
)

// Every class of the parseBool grammar: unset, empty, true forms, false forms
// (with case and whitespace), and junk.
const FLAGS = [
  undefined,
  '',
  'true',
  '1',
  ' YES ',
  'on',
  'false',
  '0',
  'Off ',
  'no',
  'junk',
]
const S_FLAGS = [undefined, 'true', 'false', 'junk']
const KILL_SWITCH = [undefined, 'false'] // CHM_FEATURE_POSTGRES_SOURCE / PEERDB_AGENT
// S-strict sets: nothing removed, or only search_tools itself removed.
const DISABLED = [[], ['search_tools']]
// Sets that remove a callable tool: S fails here (the known finding).
const DISABLED_FINDING = [['query'], ['kill_query'], ['get_peerdb_metrics']]

type Shape = {
  flag: string | undefined
  cloud: boolean
  authProvider: (typeof AUTH_PROVIDERS)[number]
  signedIn: boolean
  actionsAllowed: boolean
  connected: boolean
  postgres: boolean
  peerdb: boolean
  pgEnv: string | undefined
  peerEnv: string | undefined
  disabledTools: string[]
}

const ENV_KEYS = [
  'AGENT_ENABLE_CONTROL_TOOLS',
  'CHM_FEATURE_POSTGRES_SOURCE',
  'CHM_FEATURE_PEERDB_AGENT',
  'CHM_FEATURE_PEERDB_ENABLED',
] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

function* shapes(
  disabledSets: string[][],
  flags: (string | undefined)[] = FLAGS
): Generator<Shape> {
  for (const flag of flags)
    for (const cloud of [false, true])
      for (const authProvider of AUTH_PROVIDERS)
        for (const signedIn of [false, true])
          for (const actionsAllowed of [false, true])
            for (const connected of [false, true])
              for (const [postgres, peerdb] of [
                [false, false],
                [true, true],
              ])
                for (const pgEnv of KILL_SWITCH)
                  for (const disabledTools of disabledSets)
                    yield {
                      flag,
                      cloud,
                      authProvider,
                      signedIn,
                      actionsAllowed,
                      connected,
                      postgres,
                      peerdb,
                      pgEnv,
                      peerEnv: pgEnv,
                      disabledTools,
                    }
}

const model = new MockLanguageModelV3({})

/** The route's composition, step for step (routes/api/v1/agent.ts handlePost). */
function finalTools(s: Shape) {
  setEnv('AGENT_ENABLE_CONTROL_TOOLS', s.flag)
  setEnv('CHM_FEATURE_POSTGRES_SOURCE', s.pgEnv)
  setEnv('CHM_FEATURE_PEERDB_AGENT', s.peerEnv)
  delete process.env.CHM_FEATURE_PEERDB_ENABLED
  const controlToolsEnabled = resolveControlToolsEnabled({
    flag: process.env.AGENT_ENABLE_CONTROL_TOOLS,
    cloud: s.cloud,
    authProvider: s.authProvider,
    signedIn: s.signedIn,
  })
  // agent.ts: `includeControlTools = controlToolsEnabled && !actionsPermissionResponse`
  const includeControlTools = controlToolsEnabled && s.actionsAllowed
  const hostId = s.connected ? -1000 : 0
  const agent = createClickHouseAgent({
    model,
    hostId,
    connection: s.connected
      ? {
          hostId,
          userId: 'u1',
          connectionId: 'c1',
          credentials: {
            host: 'https://ch.example.com',
            user: 'u',
            password: 'p',
          },
        }
      : undefined,
    includeControlTools,
    integrations: { postgres: s.postgres, peerdb: s.peerdb },
    disabledTools: s.disabledTools,
    sessionId: 'formal',
  } as Parameters<typeof createClickHouseAgent>[0])
  return agent.tools as Record<
    string,
    { execute?: (...a: unknown[]) => unknown }
  >
}

const callOpts = { toolCallId: 'formal', messages: [] }

async function refusesOnConnection(tool: {
  execute?: (...a: unknown[]) => unknown
}) {
  try {
    await tool.execute?.(
      { queryId: 'q', database: 'd', table: 't', mutationId: 'm' },
      callOpts
    )
    return false
  } catch (e) {
    return /not available on your own connections/.test(
      String((e as Error).message)
    )
  }
}

async function checkWriteAndIntegration(s: Shape): Promise<string[]> {
  const tools = finalTools(s)
  const bad: string[] = []
  const tag = JSON.stringify(s)
  for (const name of CONTROL) {
    const t = tools[name]
    if (!t) continue
    const callable = !(s.connected && (await refusesOnConnection(t)))
    if (s.cloud && !s.signedIn) bad.push(`W anon-cloud got ${name}: ${tag}`)
    if (callable) {
      if (!s.actionsAllowed)
        bad.push(`W ${name} without actions permission: ${tag}`)
      if (parseBool(s.flag) === false)
        bad.push(`W ${name} with kill switch off: ${tag}`)
      if (s.cloud && parseBool(s.flag) === undefined)
        bad.push(`W ${name} in cloud without explicit opt-in: ${tag}`)
      if (s.connected)
        bad.push(`W ${name} callable on a user connection: ${tag}`)
    }
    if (s.disabledTools.includes(name))
      bad.push(`W disabled ${name} present: ${tag}`)
  }
  const liveness =
    !s.cloud &&
    s.flag === undefined &&
    s.actionsAllowed &&
    (s.authProvider !== 'clerk' || s.signedIn)
  if (liveness)
    for (const name of CONTROL)
      if (!s.disabledTools.includes(name) && !tools[name])
        bad.push(`L ${name} missing for a non-anonymous OSS caller: ${tag}`)
  for (const name of POSTGRES)
    if (tools[name] && (!s.postgres || parseBool(s.pgEnv) === false))
      bad.push(`I ${name} present with its gate off: ${tag}`)
  for (const name of PEERDB)
    if (tools[name] && (!s.peerdb || parseBool(s.peerEnv) === false))
      bad.push(`I ${name} present with its gate off: ${tag}`)
  return bad
}

async function checkSearchHonesty(s: Shape): Promise<string[]> {
  const tools = finalTools(s)
  const search = tools.search_tools
  if (!search) return [] // disabled: nothing advertised
  const out = (await search.execute?.({ query: '' }, callOpts)) as {
    callable_tool_count: number
    unavailable_due_to_gates: string[]
  }
  const unavailable = new Set(out.unavailable_due_to_gates)
  const bad: string[] = []
  const tag = JSON.stringify(s)
  for (const name of Object.keys(TOOL_CATALOG)) {
    const advertised = !unavailable.has(name)
    if (advertised && !tools[name])
      bad.push(`S advertises missing ${name}: ${tag}`)
    if (!advertised && tools[name]) bad.push(`S hides callable ${name}: ${tag}`)
  }
  if (out.callable_tool_count !== Object.keys(tools).length)
    bad.push(
      `S callable_tool_count ${out.callable_tool_count} != map size ${Object.keys(tools).length}: ${tag}`
    )
  return bad
}

async function sweep(
  disabledSets: string[][],
  check: (s: Shape) => Promise<string[]>,
  flags?: (string | undefined)[]
) {
  let n = 0
  const bad: string[] = []
  for (const s of shapes(disabledSets, flags)) {
    n++
    bad.push(...(await check(s)))
  }
  return { n, bad }
}

describe('agent tool gates — exhaustive over the request domain', () => {
  test('W, L, I hold for every request shape', async () => {
    const { n, bad } = await sweep(
      [[], ['kill_query']],
      checkWriteAndIntegration
    )
    expect(n).toBe(5632) // 11 flags x 2 x 4 auth x 2 x 2 x 2 x 2 x 2 x 2 sets
    expect(bad.slice(0, 5)).toEqual([])
  }, 120_000)

  test('S holds when disabledTools removes nothing but search_tools', async () => {
    // S reads only the resolved gate, so one flag per parseBool class is enough.
    const { n, bad } = await sweep(DISABLED, checkSearchHonesty, S_FLAGS)
    expect(n).toBe(2048)
    expect(bad.slice(0, 5)).toEqual([])
  }, 120_000)

  // KNOWN FINDING: search_tools is bound inside createAllTools(), before
  // filterTools() applies the request's disabledTools, so it still reports a
  // disabled tool as callable and overstates callable_tool_count.
  // Counterexample: disabledTools=['query'] → search_tools omits `query` from
  // unavailable_due_to_gates although agent.tools has no `query`.
  test.failing('S holds when disabledTools removes a callable tool (finding)', async () => {
    const { bad } = await sweep(DISABLED_FINDING, checkSearchHonesty, S_FLAGS)
    // test.failing: green while any shape breaks S, red once the finding is fixed.
    expect(bad.length).toBe(0)
  }, 120_000)
})
