import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  type AuditPromptInput,
  type AuditPromptOptions,
  buildAuditPrompt,
  DEFAULT_AUDIT_PROMPT_OPTIONS,
  estimateTokens,
} from '@/lib/health/audit-prompt'
import { describeError } from '@/lib/swr/fetch-error'

interface HealthAuditPromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  input: AuditPromptInput
}

/** A toggleable section, shown only when the check actually has that content. */
interface ToggleDef {
  key: keyof AuditPromptOptions
  label: string
  available: boolean
}

export function HealthAuditPromptDialog({
  open,
  onOpenChange,
  title,
  input,
}: HealthAuditPromptDialogProps) {
  const [copied, setCopied] = useState(false)
  const [options, setOptions] = useState<AuditPromptOptions>(
    DEFAULT_AUDIT_PROMPT_OPTIONS
  )

  const { check, row } = input

  // Only surface toggles for sections this particular check can populate.
  const toggles: ToggleDef[] = [
    { key: 'sql', label: 'Metric query', available: Boolean(check.sql) },
    {
      key: 'rawData',
      label: 'Raw data row',
      available: Boolean(row && Object.keys(row).length > 0),
    },
    {
      key: 'systemTables',
      label: 'System tables',
      available: Boolean(check.systemTables?.length),
    },
    {
      key: 'commonCauses',
      label: 'Common causes',
      available: Boolean(check.commonCauses?.length),
    },
    {
      key: 'relatedLinks',
      label: 'Related dashboards',
      available: Boolean(check.relatedLinks?.length),
    },
    {
      key: 'docsLinks',
      label: 'Documentation',
      available: Boolean(check.docsLinks?.length),
    },
    {
      key: 'docsMarkdown',
      label: 'Doc markdown URLs',
      available: Boolean(check.docsLinks?.length) && Boolean(options.docsLinks),
    },
  ]

  const prompt = useMemo(
    () => buildAuditPrompt(input, options),
    [input, options]
  )
  const tokens = useMemo(() => estimateTokens(prompt), [prompt])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      toast.success('Audit prompt copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      // Clipboard writes fail for reasons the user can act on (no permission,
      // or a non-secure context), so surface the browser's own reason.
      toast.error('Failed to copy prompt', { description: describeError(err) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto max-w-3xl">
        <DialogHeader>
          <DialogTitle>Audit prompt: {title}</DialogTitle>
          <DialogDescription>
            Copy and paste this prompt into any AI/coding agent (Claude,
            ChatGPT, etc.) to get a tailored diagnosis and remediation plan.
          </DialogDescription>
        </DialogHeader>

        {/* Section toggles — trim the prompt to control its size/cost. */}
        <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border p-3">
          {toggles
            .filter((t) => t.available)
            .map((t) => (
              <div key={t.key} className="flex items-center gap-2">
                <Switch
                  id={`audit-toggle-${t.key}`}
                  checked={Boolean(options[t.key])}
                  onCheckedChange={(next) =>
                    setOptions((prev) => ({ ...prev, [t.key]: next }))
                  }
                />
                <Label
                  htmlFor={`audit-toggle-${t.key}`}
                  className="text-xs font-normal"
                >
                  {t.label}
                </Label>
              </div>
            ))}
        </div>

        <ScrollArea className="h-[360px] rounded-md border">
          <Textarea
            readOnly
            value={prompt}
            className="min-h-[360px] resize-none border-0 font-mono text-xs leading-relaxed focus-visible:ring-0"
          />
        </ScrollArea>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground tabular-nums">
            ~{tokens.toLocaleString()} tokens · {prompt.length.toLocaleString()}{' '}
            chars
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={handleCopy}>
              {copied ? (
                <Check className="mr-2 size-4" />
              ) : (
                <Copy className="mr-2 size-4" />
              )}
              {copied ? 'Copied' : 'Copy prompt'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
