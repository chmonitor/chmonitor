import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useQueryFavorites } from '@/lib/stores/use-query-favorites'

export interface SaveFavoriteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sql: string
  hostId: number
  database: string | null
}

export function SaveFavoriteDialog({
  open,
  onOpenChange,
  sql,
  hostId,
  database,
}: SaveFavoriteDialogProps) {
  const { save } = useQueryFavorites()

  const defaultTitle = sql.replace(/\s+/g, ' ').trim().slice(0, 60)
  const [title, setTitle] = useState(defaultTitle)
  const [tagsInput, setTagsInput] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = () => {
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    try {
      save({
        title: title.trim() || defaultTitle,
        sql: sql.trim(),
        tags,
        hostId,
        database,
        shareUrl: '',
      })
    } catch (err) {
      // Keep the dialog open so the user's input is not lost.
      setSaveError(err instanceof Error ? err.message : String(err))
      return
    }
    setSaveError(null)
    onOpenChange(false)
    // Reset for next open.
    setTitle(defaultTitle)
    setTagsInput('')
  }

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // Re-derive title each time the dialog opens so it reflects the current SQL.
      setTitle(sql.replace(/\s+/g, ' ').trim().slice(0, 60))
      setTagsInput('')
      setSaveError(null)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save as Favorite</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="fav-title">Name</Label>
            <Input
              id="fav-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Query name…"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fav-tags">Tags</Label>
            <Input
              id="fav-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Comma-separated: perf, debug, daily…"
            />
            <p className="text-muted-foreground text-xs">
              Optional. Separate multiple tags with commas.
            </p>
          </div>

          {saveError && (
            <p role="alert" className="text-destructive text-sm">
              {saveError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!sql.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
