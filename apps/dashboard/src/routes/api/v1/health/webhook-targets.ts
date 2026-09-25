/**
 * Custom alert webhook target CRUD, preview, and explicit send-test endpoint.
 * Target URLs are treated as credentials: they are validated server-side but
 * never returned to the browser. Helm/GitOps targets are read-only in the UI;
 * D1 rows are owner-scoped and may override a Helm target by name.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { AlertPayload } from '@/lib/health/adapters'

import { validateHostUrl } from '@/lib/browser-connections/host-url'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import {
  requiresSignInForWrite,
  resolveAlertRoutingOwnerId,
} from '@/lib/health/alert-routing-auth'
import {
  listEffectiveCustomWebhookConfig,
  toPublicCustomWebhookTarget,
} from '@/lib/health/custom-webhook-config'
import {
  deleteCustomWebhookTarget,
  listCustomWebhookTargets,
  MAX_CUSTOM_WEBHOOK_TARGETS,
  upsertCustomWebhookTarget,
} from '@/lib/health/custom-webhook-target-store'
import {
  buildCustomTargetPreview,
  normalizeCustomWebhookFormat,
  samplePreviewPayload,
  sanitizeCustomHeaders,
  validateCustomWebhookDraft,
} from '@/lib/health/custom-webhook-targets'
import { postWebhook } from '@/lib/health/sweep/dispatch/webhook-post'

function jsonError(message: string, status: number): Response {
  return Response.json({ success: false, error: { message } }, { status })
}

function newTargetId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return `cwt_${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`
}

function isValidTargetId(value: unknown): value is string {
  return typeof value === 'string' && /^cwt_[0-9a-f]{24}$/.test(value)
}

async function checkTargetUrl(url: string): Promise<string | null> {
  if (!url.startsWith('https://')) {
    return 'Target URL must be an HTTPS endpoint'
  }
  if (url.length > 2048) return 'Target URL must be ≤ 2048 characters'
  const error = await validateHostUrl(url)
  return error ? 'Target URL is not allowed' : null
}

function parseHeaders(raw: unknown): Record<string, string> {
  return sanitizeCustomHeaders(raw).headers
}

function parseDraftBody(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

async function requireWriteAccess(
  request: Request,
  action: string
): Promise<Response | null> {
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse
  const ownerId = await resolveAlertRoutingOwnerId()
  if (requiresSignInForWrite(ownerId)) {
    return jsonError(`Sign in to ${action} custom webhook targets.`, 401)
  }
  return null
}

async function handleGet(): Promise<Response> {
  const ownerId = await resolveAlertRoutingOwnerId()
  const effective = await listEffectiveCustomWebhookConfig(ownerId)
  return Response.json(
    {
      success: true,
      targets: effective.targets.map(toPublicCustomWebhookTarget),
      storage: effective.storage,
    },
    { status: 200 }
  )
}

async function handlePut(request: Request): Promise<Response> {
  const denied = await requireWriteAccess(request, 'edit')
  if (denied) return denied
  const ownerId = await resolveAlertRoutingOwnerId()

  let body: Record<string, unknown>
  try {
    body = parseDraftBody(await request.json())
  } catch {
    return jsonError('Request body must be valid JSON', 400)
  }

  const existing = await listCustomWebhookTargets(ownerId)
  const requestedId = body.id
  const id =
    typeof requestedId === 'string' && isValidTargetId(requestedId)
      ? requestedId
      : newTargetId()
  const previous = existing.find((target) => target.id === id)
  if (requestedId !== undefined && !previous && isValidTargetId(requestedId)) {
    return jsonError('Custom webhook target not found', 404)
  }
  if (!previous && existing.length >= MAX_CUSTOM_WEBHOOK_TARGETS) {
    return jsonError(
      `Too many custom targets (max ${MAX_CUSTOM_WEBHOOK_TARGETS})`,
      400
    )
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url && !previous) return jsonError('Missing "url"', 400)
  if (url) {
    const urlError = await checkTargetUrl(url)
    if (urlError) return jsonError(urlError, 400)
  }

  const validated = validateCustomWebhookDraft({
    name: body.name ?? previous?.name,
    url,
    enabled: body.enabled,
    format: body.format ?? previous?.format,
    minSeverity: body.minSeverity ?? previous?.minSeverity,
    titleTemplate: body.titleTemplate ?? previous?.titleTemplate,
    bodyTemplate: body.bodyTemplate ?? previous?.bodyTemplate,
    headers: body.headers ?? previous?.headers,
  })
  if (!validated.ok)
    return jsonError(validated.errors[0] ?? 'Invalid target', 400)

  const saved = await upsertCustomWebhookTarget({
    ownerId,
    id,
    name: validated.name,
    url,
    enabled:
      body.enabled === undefined
        ? (previous?.enabled ?? false)
        : body.enabled === true,
    format: validated.format,
    minSeverity: validated.minSeverity,
    titleTemplate: validated.titleTemplate,
    bodyTemplate: validated.bodyTemplate,
    headers: validated.headers,
  })
  if (!saved) {
    return jsonError(
      'Custom webhook storage is not configured (no D1 binding) or the write failed.',
      501
    )
  }

  const effective = await listEffectiveCustomWebhookConfig(ownerId)
  const publicTarget = effective.targets.find((target) => target.id === id)
  return Response.json(
    {
      success: true,
      target: publicTarget ? toPublicCustomWebhookTarget(publicTarget) : null,
    },
    { status: 200 }
  )
}

async function handleDelete(request: Request): Promise<Response> {
  const denied = await requireWriteAccess(request, 'delete')
  if (denied) return denied
  const ownerId = await resolveAlertRoutingOwnerId()
  const id = new URL(request.url).searchParams.get('id')
  if (!isValidTargetId(id))
    return jsonError('Missing or invalid "id" query param', 400)
  if (!(await deleteCustomWebhookTarget(ownerId, id))) {
    return jsonError('Custom webhook target not found', 404)
  }
  return Response.json({ success: true }, { status: 200 })
}

async function handlePreview(request: Request): Promise<Response> {
  const denied = await requireWriteAccess(request, 'preview')
  if (denied) return denied
  const ownerId = await resolveAlertRoutingOwnerId()
  let body: Record<string, unknown>
  try {
    body = parseDraftBody(await request.json())
  } catch {
    return jsonError('Request body must be valid JSON', 400)
  }

  const effective = await listEffectiveCustomWebhookConfig(ownerId)
  const id = typeof body.id === 'string' ? body.id : undefined
  const saved = id
    ? effective.targets.find((target) => target.id === id)
    : undefined
  const url =
    typeof body.url === 'string' && body.url.trim()
      ? body.url.trim()
      : saved?.url
  if (!url) return jsonError('Missing "url"', 400)
  const urlError = await checkTargetUrl(url)
  if (urlError) return jsonError(urlError, 400)

  const format =
    body.format === undefined && saved
      ? saved.format
      : normalizeCustomWebhookFormat(body.format)
  const titleTemplate =
    typeof body.titleTemplate === 'string'
      ? body.titleTemplate
      : (saved?.titleTemplate ?? '')
  const bodyTemplate =
    typeof body.bodyTemplate === 'string'
      ? body.bodyTemplate
      : (saved?.bodyTemplate ?? '')
  const headers =
    body.headers === undefined
      ? (saved?.headers ?? {})
      : parseHeaders(body.headers)
  const validated = validateCustomWebhookDraft({
    name: saved?.name ?? 'preview',
    url,
    format,
    titleTemplate,
    bodyTemplate,
    headers,
  })
  if (!validated.ok)
    return jsonError(validated.errors[0] ?? 'Invalid target', 400)

  const payload: AlertPayload = samplePreviewPayload()
  const preview = buildCustomTargetPreview(
    {
      url,
      format: validated.format,
      titleTemplate: validated.titleTemplate,
      bodyTemplate: validated.bodyTemplate,
      headers: validated.headers,
    },
    payload
  )

  if (body.send === true) {
    const result = await postWebhook(url, preview.body, {
      headers: validated.headers,
      redirect: 'error',
    })
    if (!result.ok) return jsonError('Custom webhook test failed', 502)
    return Response.json(
      { success: true, sent: true, preview },
      { status: 200 }
    )
  }

  return Response.json({ success: true, preview }, { status: 200 })
}

export const Route = createFileRoute('/api/v1/health/webhook-targets')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      PUT: async ({ request }) => handlePut(request),
      POST: async ({ request }) => handlePreview(request),
      DELETE: async ({ request }) => handleDelete(request),
    },
  },
})

export {
  handleGet as __handleGetForTests,
  handlePut as __handlePutForTests,
  handleDelete as __handleDeleteForTests,
  handlePreview as __handlePreviewForTests,
}
