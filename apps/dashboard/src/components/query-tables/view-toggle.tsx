import { LayoutGrid, Table2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function ViewToggle({
  active,
  onChange,
}: {
  active: 'table' | 'cards'
  onChange: (view: 'table' | 'cards') => void
}) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5"
      role="group"
      aria-label="Result view"
    >
      <Button
        type="button"
        variant={active === 'table' ? 'secondary' : 'ghost'}
        size="sm"
        className="gap-1.5 px-2 text-xs"
        aria-pressed={active === 'table'}
        onClick={() => onChange('table')}
      >
        <Table2 className="size-3.5" />
        Table
      </Button>
      <Button
        type="button"
        variant={active === 'cards' ? 'secondary' : 'ghost'}
        size="sm"
        className="gap-1.5 px-2 text-xs"
        aria-pressed={active === 'cards'}
        onClick={() => onChange('cards')}
      >
        <LayoutGrid className="size-3.5" />
        Cards
      </Button>
    </div>
  )
}
