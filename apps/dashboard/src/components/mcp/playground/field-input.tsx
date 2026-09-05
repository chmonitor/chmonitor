import type { FormField } from '@/lib/mcp'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField
  value: string
  onChange: (value: string) => void
}) {
  const options =
    field.kind === 'boolean' ? ['true', 'false'] : (field.options ?? [])

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs font-medium">
          <code>{field.name}</code>
        </Label>
        <span className="text-xs text-muted-foreground">{field.kind}</span>
        {field.required && (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            required
          </Badge>
        )}
      </div>
      {options.length > 0 ? (
        <Select
          value={value}
          onValueChange={(next) => {
            if (next != null) onChange(next)
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Default" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option} className="text-xs">
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.name === 'sql' ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.description ?? 'SELECT 1'}
          rows={3}
          className="font-mono text-xs"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            field.default !== undefined
              ? `Default: ${field.default}`
              : field.description
          }
          className="h-8 font-mono text-xs"
        />
      )}
      {field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}
    </div>
  )
}
