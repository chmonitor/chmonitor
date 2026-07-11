/**
 * AddWidgetMenu — minimal "Add Widget" affordance for the three widget
 * types not covered by `ChartPicker` (table / stat / text). Each opens a
 * small dialog collecting just enough to construct the widget; the caller
 * (`dashboard.tsx`) is responsible for assigning grid position/size —
 * this component only emits the widget's type-specific fields.
 */

import { PlusIcon } from '@radix-ui/react-icons'

import type { WidgetType } from '@/types/dashboard-layout'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { queries } from '@/lib/query-config'

export interface NewWidgetInput {
  type: WidgetType
  chartName?: string
  queryConfigName?: string
  title?: string
  props?: Record<string, unknown>
}

interface AddWidgetMenuProps {
  onAdd: (widget: NewWidgetInput) => void
}

const TABLE_OPTIONS = queries.map((q) => q.name).sort()

export function AddWidgetMenu({ onAdd }: AddWidgetMenuProps) {
  const [dialog, setDialog] = useState<'table' | 'stat' | 'text' | null>(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          <PlusIcon className="mr-1 size-3" />
          Add Widget
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setDialog('table')}>
            Table…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog('stat')}>
            Stat…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog('text')}>
            Text…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AddTableDialog
        open={dialog === 'table'}
        onOpenChange={(open) => setDialog(open ? 'table' : null)}
        onAdd={onAdd}
      />
      <AddStatDialog
        open={dialog === 'stat'}
        onOpenChange={(open) => setDialog(open ? 'stat' : null)}
        onAdd={onAdd}
      />
      <AddTextDialog
        open={dialog === 'text'}
        onOpenChange={(open) => setDialog(open ? 'text' : null)}
        onAdd={onAdd}
      />
    </>
  )
}

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (widget: NewWidgetInput) => void
}

function AddTableDialog({ open, onOpenChange, onAdd }: DialogProps) {
  const [name, setName] = useState('')

  function handleAdd() {
    if (!name) return
    onAdd({ type: 'table', queryConfigName: name })
    setName('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add table widget</DialogTitle>
          <DialogDescription>
            Pick a data view to render as a table on the dashboard.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="add-table-query">Query</Label>
          <Select
            value={name}
            onValueChange={(value) => {
              if (value != null) setName(value)
            }}
          >
            <SelectTrigger id="add-table-query" className="w-full">
              <SelectValue placeholder="Select a query…" />
            </SelectTrigger>
            <SelectContent>
              {TABLE_OPTIONS.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!name}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddStatDialog({ open, onOpenChange, onAdd }: DialogProps) {
  const [label, setLabel] = useState('')
  const [sql, setSql] = useState('')

  function handleAdd() {
    if (!sql.trim()) return
    onAdd({
      type: 'stat',
      title: label || undefined,
      props: { statQuery: sql.trim(), statLabel: label || undefined },
    })
    setLabel('')
    setSql('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add stat widget</DialogTitle>
          <DialogDescription>
            A single-value SQL query (read-only), shown large with a label.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-2">
            <Label htmlFor="add-stat-label">Label</Label>
            <Input
              id="add-stat-label"
              placeholder="Total tables"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="add-stat-sql">SQL query</Label>
            <Textarea
              id="add-stat-sql"
              placeholder="SELECT count() AS c FROM system.tables"
              className="font-mono text-xs"
              rows={4}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!sql.trim()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddTextDialog({ open, onOpenChange, onAdd }: DialogProps) {
  const [markdown, setMarkdown] = useState('')

  function handleAdd() {
    if (!markdown.trim()) return
    onAdd({ type: 'text', props: { markdown: markdown.trim() } })
    setMarkdown('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add text widget</DialogTitle>
          <DialogDescription>
            Markdown notes shown as-is — useful for context or a runbook link.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="add-text-markdown">Markdown</Label>
          <Textarea
            id="add-text-markdown"
            placeholder="## Notes&#10;Anything you want teammates to see."
            rows={5}
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!markdown.trim()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
