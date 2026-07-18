import { Check, Copy, Pencil, Play, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import type { QueryFavorite } from '@/lib/stores/use-query-favorites'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useQueryFavorites } from '@/lib/stores/use-query-favorites'
import { describeError } from '@/lib/swr/fetch-error'
import { cn } from '@/lib/utils'

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function QueryLine({ sql }: { sql: string }) {
  const oneLine = sql.replace(/\s+/g, ' ').trim()
  return (
    <code className="line-clamp-2 break-words font-mono text-xs leading-snug">
      {oneLine}
    </code>
  )
}

interface EditRowState {
  title: string
  tags: string
}

function FavoriteItem({
  fav,
  onSelect,
  onRemove,
  onUpdate,
}: {
  fav: QueryFavorite
  onSelect: (sql: string, run?: boolean) => void
  onRemove: (id: string) => void
  onUpdate: (
    id: string,
    patch: Partial<Pick<QueryFavorite, 'title' | 'tags'>>
  ) => void
}) {
  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState<EditRowState>({ title: '', tags: '' })
  const [copied, setCopied] = useState(false)

  const startEdit = () => {
    setEdit({ title: fav.title, tags: fav.tags.join(', ') })
    setEditing(true)
  }

  const commitEdit = () => {
    const tags = edit.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    onUpdate(fav.id, { title: edit.title.trim() || fav.title, tags })
    setEditing(false)
  }

  const cancelEdit = () => setEditing(false)

  const copyLink = async () => {
    if (!fav.shareUrl) return
    try {
      await navigator.clipboard.writeText(fav.shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      // Silent failure here left the user clicking Copy with no feedback (#2729).
      toast.error('Failed to copy link', { description: describeError(err) })
    }
  }

  return (
    <li
      className={cn(
        'group hover:bg-muted/60 rounded-md border p-2 transition-colors',
        editing && 'border-primary/40 bg-muted/40'
      )}
    >
      {editing ? (
        <div className="space-y-2">
          <Input
            value={edit.title}
            onChange={(e) => setEdit((s) => ({ ...s, title: e.target.value }))}
            placeholder="Name…"
            className="h-7 text-xs"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit()
              if (e.key === 'Escape') cancelEdit()
            }}
          />
          <Input
            value={edit.tags}
            onChange={(e) => setEdit((s) => ({ ...s, tags: e.target.value }))}
            placeholder="Tags (comma-separated)…"
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit()
              if (e.key === 'Escape') cancelEdit()
            }}
          />
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={cancelEdit}
            >
              <X className="mr-1 size-3" /> Cancel
            </Button>
            <Button size="sm" className="h-6 text-xs" onClick={commitEdit}>
              <Check className="mr-1 size-3" /> Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="block w-full text-left"
            onClick={() => onSelect(fav.sql, false)}
            title="Load into editor"
          >
            <p className="truncate text-xs font-medium">{fav.title}</p>
            <QueryLine sql={fav.sql} />
          </button>

          {fav.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {fav.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="h-4 px-1.5 text-[10px]"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <div className="text-muted-foreground mt-1.5 flex items-center justify-between text-[11px]">
            <span>{relTime(fav.createdAt)}</span>
            <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {fav.shareUrl && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  title="Copy deep-link"
                  aria-label="Copy deep-link"
                  onClick={copyLink}
                >
                  {copied ? (
                    <Check className="size-3 text-emerald-500" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title="Run"
                aria-label="Run"
                onClick={() => onSelect(fav.sql, true)}
              >
                <Play className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title="Edit name / tags"
                aria-label="Edit name / tags"
                onClick={startEdit}
              >
                <Pencil className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title="Remove"
                aria-label="Remove"
                onClick={() => onRemove(fav.id)}
              >
                <Trash2 className="size-3" />
              </Button>
            </span>
          </div>
        </>
      )}
    </li>
  )
}

export interface QueryFavoritesPanelProps {
  onSelect: (sql: string, run?: boolean) => void
}

export function QueryFavoritesPanel({ onSelect }: QueryFavoritesPanelProps) {
  const { favorites, remove, update } = useQueryFavorites()
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)

  const allTags = useMemo(
    () => Array.from(new Set(favorites.flatMap((f) => f.tags))).sort(),
    [favorites]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return favorites.filter((f) => {
      if (activeTag && !f.tags.includes(activeTag)) return false
      if (!q) return true
      return (
        f.title.toLowerCase().includes(q) ||
        f.sql.toLowerCase().includes(q) ||
        f.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [favorites, search, activeTag])

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 px-3 py-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search favorites…"
          className="h-7 text-xs"
        />
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  activeTag === tag
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted'
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
        <p className="text-muted-foreground text-[11px]">
          {filtered.length} of {favorites.length} favorite
          {favorites.length !== 1 ? 's' : ''}
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ul className="space-y-1 px-2 pb-4">
          {favorites.length === 0 && (
            <li className="text-muted-foreground p-4 text-center text-sm">
              No saved favorites yet. Save queries from the SQL console or
              EXPLAIN page.
            </li>
          )}
          {favorites.length > 0 && filtered.length === 0 && (
            <li className="text-muted-foreground p-4 text-center text-sm">
              No favorites match your search.
            </li>
          )}
          {filtered.map((fav) => (
            <FavoriteItem
              key={fav.id}
              fav={fav}
              onSelect={onSelect}
              onRemove={remove}
              onUpdate={update}
            />
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}
