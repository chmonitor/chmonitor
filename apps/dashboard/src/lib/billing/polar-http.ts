/**
 * Thin Polar REST client — replaces `@polar-sh/sdk` on the Worker runtime path.
 *
 * Why: the Speakeasy-generated SDK is ~1.3 MiB raw / ~114 KiB gzip and is the
 * single largest *optional* dependency in the free-plan 3 MiB worker upload.
 * We only call two endpoints (customer state, customer update). Checkout
 * create and customer-session create lived here for dashboard Polar billing
 * routes that were removed; license checkout is on `apps/cloud-hooks`. A
 * ~100-line fetch wrapper keeps behaviour and leaves the SDK available for
 * `scripts/polar-setup.ts` (dev only).
 *
 * Wire format is snake_case; this module remaps the few fields callers need
 * into the camelCase shape the previous SDK surface exposed.
 */

// Keep server selection local to avoid a circular import with polar-config
// (config constructs this client; this module only needs the env flag).
function polarServer(): 'sandbox' | 'production' {
  return process.env.CHM_POLAR_SERVER === 'production'
    ? 'production'
    : 'sandbox'
}

const API_BASE: Record<'sandbox' | 'production', string> = {
  sandbox: 'https://sandbox-api.polar.sh',
  production: 'https://api.polar.sh',
}

export class PolarHttpError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string, message?: string) {
    super(message ?? `Polar API ${status}`)
    this.name = 'PolarHttpError'
    this.status = status
    this.body = body
  }
}

/** Minimal subscription row from GET /v1/customers/external/{id}/state */
export interface PolarActiveSubscription {
  productId: string
  status: string
  currentPeriodEnd: Date | string | null
  cancelAtPeriodEnd: boolean
}

export interface PolarCustomerState {
  activeSubscriptions: PolarActiveSubscription[]
}

function authHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

async function polarFetch(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const base = API_BASE[polarServer()]
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...authHeaders(accessToken),
      ...(init?.headers ?? {}),
    },
  })
  return res
}

function asDate(value: unknown): Date | string | null {
  if (value == null) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') return value
  if (typeof value === 'number') return new Date(value)
  return null
}

function mapSubscription(
  raw: Record<string, unknown>
): PolarActiveSubscription {
  return {
    productId: String(raw.product_id ?? raw.productId ?? ''),
    status: String(raw.status ?? ''),
    currentPeriodEnd: asDate(
      raw.current_period_end ?? raw.currentPeriodEnd ?? null
    ),
    cancelAtPeriodEnd: Boolean(
      raw.cancel_at_period_end ?? raw.cancelAtPeriodEnd ?? false
    ),
  }
}

function mapCustomerState(json: unknown): PolarCustomerState {
  const obj = (json ?? {}) as Record<string, unknown>
  const list = (obj.active_subscriptions ??
    obj.activeSubscriptions ??
    []) as unknown[]
  return {
    activeSubscriptions: list
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map(mapSubscription),
  }
}

/**
 * Polar client surface used by dashboard billing routes. Drop-in replacement
 * for the subset of `@polar-sh/sdk` Polar we previously constructed.
 */
export interface PolarHttpClient {
  customers: {
    getStateExternal: (args: {
      externalId: string
    }) => Promise<PolarCustomerState>
    update: (args: {
      id: string
      customerUpdate: { externalId: string }
    }) => Promise<void>
  }
}

export function createPolarHttpClient(accessToken: string): PolarHttpClient {
  return {
    customers: {
      async getStateExternal({ externalId }) {
        const res = await polarFetch(
          accessToken,
          `/v1/customers/external/${encodeURIComponent(externalId)}/state`
        )
        if (res.status === 404) {
          throw new PolarHttpError(404, await res.text(), 'ResourceNotFound')
        }
        if (!res.ok) {
          throw new PolarHttpError(res.status, await res.text())
        }
        return mapCustomerState(await res.json())
      },
      async update({ id, customerUpdate }) {
        const res = await polarFetch(
          accessToken,
          `/v1/customers/${encodeURIComponent(id)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              external_id: customerUpdate.externalId,
            }),
          }
        )
        if (!res.ok) {
          throw new PolarHttpError(res.status, await res.text())
        }
      },
    },
  }
}
