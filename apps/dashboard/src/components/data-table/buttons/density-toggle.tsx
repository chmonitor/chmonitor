import { AlignJustifyIcon, ListIcon, Rows3Icon } from 'lucide-react'

import type { TableDensity } from '@/components/data-table/hooks/use-table-density'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const DENSITY_OPTIONS: {
  value: TableDensity
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { value: 'comfortable', label: 'Comfortable', icon: AlignJustifyIcon },
  { value: 'compact', label: 'Compact', icon: Rows3Icon },
  { value: 'dense', label: 'Dense', icon: ListIcon },
]

interface DensityToggleProps {
  density: TableDensity
  onDensityChange: (density: TableDensity) => void
}

export const DensityToggle = function DensityToggle({
  density,
  onDensityChange,
}: DensityToggleProps) {
  const current = DENSITY_OPTIONS.find((o) => o.value === density)
  const Icon = current?.icon ?? AlignJustifyIcon

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 sm:size-5 opacity-40 hover:opacity-100 transition-opacity rounded-full"
            aria-label="Row density"
            title="Row density"
          />
        }
      >
        <Icon className="size-3 sm:size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={density}
          onValueChange={(v) => onDensityChange(v as TableDensity)}
        >
          {DENSITY_OPTIONS.map(({ value, label, icon: ItemIcon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <ItemIcon className="mr-2 size-3.5" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
