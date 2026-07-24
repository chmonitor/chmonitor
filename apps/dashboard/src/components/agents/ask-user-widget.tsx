'use client'

import { CheckIcon, MessageCircleQuestionIcon, StarIcon } from 'lucide-react'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface AskUserOutput {
  type: 'ask_user'
  question: string
  inputType:
    | 'single_choice'
    | 'multi_choice'
    | 'confirm'
    | 'free_text'
    | 'rating'
  options?: Array<{ label: string; value: string; description?: string }>
  placeholder?: string
  min?: number
  max?: number
  context?: string
  awaiting_response?: boolean
}

interface AskUserWidgetProps {
  readonly output: AskUserOutput
  readonly toolCallId: string
  readonly onSubmit: (toolCallId: string, result: string) => void
  readonly isSubmitted?: boolean
}

export function isAskUserOutput(output: unknown): output is AskUserOutput {
  if (!output || typeof output !== 'object') return false
  const obj = output as Record<string, unknown>
  return obj.type === 'ask_user' && typeof obj.question === 'string'
}

/**
 * Render an interactive "ask user" widget that displays a question and collects a response according to `output.inputType`.
 *
 * @param output - Configuration for the prompt (must have `type: 'ask_user'` and `question`); supports `inputType` = `'single_choice' | 'multi_choice' | 'confirm' | 'free_text' | 'rating'`. Optional fields: `options`, `placeholder`, `min`, `max`, `context`, and `awaiting_response`. `options` entries may include `label`, `value`, and `description`.
 * @param toolCallId - Identifier supplied to `onSubmit` when a response is submitted.
 * @param onSubmit - Callback invoked as `onSubmit(toolCallId, result)` when the user submits a response; `result` is a string (e.g., selected value, JSON array string for multi-choice, `'yes'`/`'no'`, trimmed free-text, or rating number as a string).
 * @param isSubmitted - Optional initial submitted state (defaults to `false`).
 * @returns The rendered Ask User widget element.
 */
export function AskUserWidget({
  output,
  toolCallId,
  onSubmit,
  isSubmitted = false,
}: AskUserWidgetProps) {
  const safeOptions = (output.options ?? []).slice(0, 20).map((opt) => ({
    ...opt,
    label: opt.label.slice(0, 80),
    value: opt.value.slice(0, 120),
    description: opt.description?.slice(0, 200),
  }))
  const safeMin = Number.isFinite(output.min)
    ? Math.trunc(output.min as number)
    : 1
  const safeMax = Number.isFinite(output.max)
    ? Math.trunc(output.max as number)
    : 5
  const ratingMin = Math.max(1, Math.min(10, safeMin))
  const ratingMax = Math.max(ratingMin, Math.min(10, safeMax))
  const ratingSpan = Math.min(10, ratingMax - ratingMin + 1)
  const [selectedValue, setSelectedValue] = useState<string>('')
  const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set())
  const [textValue, setTextValue] = useState('')
  const [ratingValue, setRatingValue] = useState(0)
  const [submitted, setSubmitted] = useState(isSubmitted)

  const handleSubmit = (value: string) => {
    setSubmitted(true)
    onSubmit(toolCallId, value)
  }

  if (submitted) {
    return (
      <div className="my-2 rounded-lg border border-[var(--chart-green)]/30 bg-[var(--chart-green)]/10 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-[var(--chart-green)]">
          <CheckIcon className="size-4" />
          <span>Response submitted</span>
        </div>
      </div>
    )
  }

  return (
    <div className="my-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      {/* Question header */}
      <div className="flex items-start gap-2 mb-3">
        <MessageCircleQuestionIcon className="size-4 mt-0.5 text-primary shrink-0" />
        <div>
          {output.context && (
            <p className="text-xs text-muted-foreground mb-1">
              {output.context}
            </p>
          )}
          <p className="text-sm font-medium">{output.question}</p>
        </div>
      </div>

      {/* Input widget based on type */}
      {output.inputType === 'single_choice' && safeOptions.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {safeOptions.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => setSelectedValue(opt.value)}
              className={cn(
                'flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                selectedValue === opt.value
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:bg-muted/50'
              )}
            >
              <div
                className={cn(
                  'mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center',
                  selectedValue === opt.value
                    ? 'border-primary'
                    : 'border-muted-foreground/40'
                )}
              >
                {selectedValue === opt.value && (
                  <div className="size-2 rounded-full bg-primary" />
                )}
              </div>
              <div>
                <span className="font-medium">{opt.label}</span>
                {opt.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {opt.description}
                  </p>
                )}
              </div>
            </button>
          ))}
          <Button
            size="sm"
            disabled={!selectedValue}
            onClick={() => handleSubmit(selectedValue)}
            className="mt-2"
          >
            Submit
          </Button>
        </div>
      )}

      {output.inputType === 'multi_choice' && safeOptions.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {safeOptions.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                'flex w-full items-start gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors',
                selectedValues.has(opt.value)
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:bg-muted/50'
              )}
            >
              <Checkbox
                checked={selectedValues.has(opt.value)}
                onCheckedChange={(checked) => {
                  const next = new Set(selectedValues)
                  if (checked) {
                    next.add(opt.value)
                  } else {
                    next.delete(opt.value)
                  }
                  setSelectedValues(next)
                }}
                className="mt-0.5"
              />
              <div>
                <span className="font-medium">{opt.label}</span>
                {opt.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {opt.description}
                  </p>
                )}
              </div>
            </label>
          ))}
          <Button
            size="sm"
            disabled={selectedValues.size === 0}
            onClick={() =>
              handleSubmit(JSON.stringify(Array.from(selectedValues)))
            }
            className="mt-2"
          >
            Submit ({selectedValues.size} selected)
          </Button>
        </div>
      )}

      {output.inputType === 'confirm' && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => handleSubmit('yes')}>
            Yes
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleSubmit('no')}
          >
            No
          </Button>
        </div>
      )}

      {output.inputType === 'free_text' && (
        <div className="space-y-2">
          <Input
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            placeholder={(output.placeholder || 'Type your response...').slice(
              0,
              200
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && textValue.trim()) {
                handleSubmit(textValue.trim())
              }
            }}
          />
          <Button
            size="sm"
            disabled={!textValue.trim()}
            onClick={() => handleSubmit(textValue.trim())}
          >
            Submit
          </Button>
        </div>
      )}

      {output.inputType === 'rating' && (
        <div className="space-y-2">
          <div className="flex gap-1">
            {Array.from({ length: ratingSpan }, (_, i) => i + ratingMin).map(
              (n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => setRatingValue(n)}
                  className={cn(
                    'p-1 transition-colors',
                    ratingValue >= n
                      ? 'text-[var(--chart-yellow)]'
                      : 'text-muted-foreground/30 hover:text-[var(--chart-yellow)]/60'
                  )}
                >
                  <StarIcon
                    className="size-6"
                    fill={ratingValue >= n ? 'currentColor' : 'none'}
                  />
                </button>
              )
            )}
          </div>
          <Button
            size="sm"
            disabled={ratingValue === 0}
            onClick={() => handleSubmit(String(ratingValue))}
          >
            Submit ({ratingValue}/{ratingMax})
          </Button>
        </div>
      )}
    </div>
  )
}
