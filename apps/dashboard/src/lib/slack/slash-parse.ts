/**
 * Pure parser for `/chmonitor <subcommand> [args]` (plans/37).
 *
 * Only the subcommands actually implemented this round are recognized
 * (status | query | alert); anything else resolves to `help` so the command
 * always responds with usage rather than silently doing nothing. Kept pure so
 * the dispatch mapping is unit-testable without the route's Worker imports.
 */

export type SlashSub = 'status' | 'query' | 'alert' | 'help'

export interface ParsedSlash {
  sub: SlashSub
  /** Remaining argument text after the subcommand (e.g. the SQL for `query`). */
  arg: string
  /** Host index for status/alert; defaults to 0. */
  hostId: number
}

const KNOWN: ReadonlySet<string> = new Set(['status', 'query', 'alert'])

export function parseSlashCommand(text: string): ParsedSlash {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { sub: 'help', arg: '', hostId: 0 }

  const firstSpace = trimmed.indexOf(' ')
  const word = (
    firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)
  ).toLowerCase()
  const rest = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim()

  if (!KNOWN.has(word)) return { sub: 'help', arg: trimmed, hostId: 0 }

  const sub = word as Exclude<SlashSub, 'help'>

  // For status/alert a bare trailing integer selects the host (e.g. "status 1").
  // For query the whole remainder is SQL, so never treat it as a host index.
  let hostId = 0
  let arg = rest
  if (sub !== 'query' && /^\d+$/.test(rest)) {
    hostId = Number(rest)
    arg = ''
  }

  return { sub, arg, hostId }
}
