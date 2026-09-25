'use client'

import { Plus, Webhook } from 'lucide-react'

import { CustomWebhookTargetCard } from './custom-webhook-target-card'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Separator } from '@/components/ui/separator'
import {
  type CustomWebhookTargetInput,
  useCustomWebhookTargetMutations,
  useCustomWebhookTargets,
} from '@/lib/hooks/use-custom-webhook-targets'
import { describeError } from '@/lib/swr/fetch-error'

/** Small list/controller; the form and preview live in their own component. */
export function CustomWebhookTargetsPanel() {
  const { targets, storage, isLoading, error } = useCustomWebhookTargets()
  const { save, remove, preview } = useCustomWebhookTargetMutations()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)

  const editableTargets = targets.filter((target) => target.editable)
  const helmTargets = targets.filter((target) => !target.editable)
  const selected =
    editableTargets.find((target) => target.id === selectedId) ??
    editableTargets[0] ??
    null

  const run = async <T,>(action: () => Promise<T>): Promise<T> => {
    setBusy(true)
    try {
      return await action()
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async (input: CustomWebhookTargetInput) => {
    await run(async () => {
      const saved = await save(input)
      if (saved) {
        setCreating(false)
        setSelectedId(saved.id)
      }
    })
  }

  const handleRemove = async () => {
    if (!selected) return
    await run(async () => {
      await remove(selected.id)
      setSelectedId(null)
    })
  }

  const handlePreview = async (
    input: CustomWebhookTargetInput,
    send: boolean
  ) => {
    let result!: Awaited<ReturnType<typeof preview>>
    await run(async () => {
      result = await preview({ ...input, send })
    })
    return result
  }

  if (isLoading) {
    return (
      <div
        className="h-32 animate-pulse rounded-xl bg-muted/30"
        aria-label="Loading custom webhooks"
      />
    )
  }

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="custom-webhooks-title"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Webhook
            className="mt-0.5 size-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <div>
            <h2 id="custom-webhooks-title" className="text-sm font-medium">
              Custom webhook targets
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Choose raw JSON, Slack, or Element/Matrix formatting. Helm targets
              are read-only; saved D1 targets can override them by name.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setCreating(true)
            setSelectedId(null)
          }}
          disabled={busy || storage === 'unavailable'}
        >
          <Plus className="size-3.5" strokeWidth={1.5} />
          Add target
        </Button>
      </div>

      {storage === 'unavailable' && (
        <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          D1 storage is not configured in this deployment. Helm/GitOps targets
          still deliver; UI-created targets require the metadata database
          migration.
        </p>
      )}
      {error instanceof Error && (
        <p role="alert" className="text-xs text-destructive">
          {describeError(error)}
        </p>
      )}

      {helmTargets.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Helm / GitOps
          </p>
          {helmTargets.map((target) => (
            <div
              key={target.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs"
            >
              <span className="font-medium">{target.name}</span>
              <span className="text-muted-foreground">
                {target.format} · {target.enabled ? 'enabled' : 'disabled'} ·{' '}
                {target.urlMasked}
              </span>
            </div>
          ))}
        </div>
      )}

      {editableTargets.length > 0 && !creating && (
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Saved custom webhooks"
        >
          {editableTargets.map((target) => (
            <Button
              key={target.id}
              type="button"
              variant={selected?.id === target.id ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => {
                setCreating(false)
                setSelectedId(target.id)
              }}
            >
              {target.name}
            </Button>
          ))}
        </div>
      )}

      {(creating || selected) && (
        <>
          {editableTargets.length > 0 && <Separator />}
          <CustomWebhookTargetCard
            target={creating ? null : selected}
            busy={busy}
            onSave={handleSave}
            onRemove={handleRemove}
            onPreview={handlePreview}
          />
        </>
      )}

      {!creating &&
        editableTargets.length === 0 &&
        helmTargets.length === 0 && (
          <div className="rounded-xl border border-dashed bg-card/50 p-4">
            <EmptyState
              variant="no-data"
              icon={<Webhook className="size-5" strokeWidth={1.5} />}
              title="No custom webhook targets"
              description="Add a target for raw JSON, Slack, or Element/Matrix alerts, or configure one through Helm."
              action={
                <Button
                  size="sm"
                  onClick={() => setCreating(true)}
                  disabled={storage === 'unavailable'}
                >
                  <Plus className="size-3.5" strokeWidth={1.5} />
                  Add target
                </Button>
              }
            />
          </div>
        )}
    </section>
  )
}
