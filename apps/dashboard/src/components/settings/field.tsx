import { Label } from '@/components/ui/label'

export function Field({
  label,
  icon: Icon,
  description,
  children,
}: {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-sm font-medium">
        {Icon && <Icon className="size-3.5" aria-hidden="true" />}
        {label}
      </Label>
      {children}
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  )
}
