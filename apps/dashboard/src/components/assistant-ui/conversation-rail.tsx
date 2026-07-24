'use client'

/**
 * ConversationRail — the persistent, collapsible conversation history rail on
 * the AI Agent page (issue #2802). Replaces the old centered "Conversations"
 * dialog: the thread list is now always visible, one click switches threads.
 *
 * This is the single source of truth for rendering saved conversations — the
 * rail, its mobile Drawer, and the welcome-screen recent list all render the
 * same {@link ThreadRow} over {@link useConversationItems} (issue #2809,
 * consolidating `thread-list.tsx` + `recent-threads-rail.tsx` + the dialog).
 *
 * Data comes from assistant-ui's thread-list runtime (`useThreadList`), so it
 * stays in sync with the persistent adapter (D1 or localStorage).
 */

import {
  ArchiveIcon,
  MessagesSquareIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react'

import { useAssistantRuntime, useThreadList } from '@assistant-ui/react'
import { useMemo, useState } from 'react'
import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/utils/format-relative-time'

export interface ConversationItem {
  id: string
  title: string
  createdAt: number | undefined
  isActive: boolean
}

/** Sorted (newest first) list of saved conversations from the runtime. */
export function useConversationItems(): ConversationItem[] {
  const threadIds = useThreadList((s) => s.threadIds)
  const threadItems = useThreadList((s) => s.threadItems)
  const mainThreadId = useThreadList((s) => s.mainThreadId)

  return useMemo(() => {
    return threadIds
      .map((id) => {
        const it = threadItems[id]
        const custom = it?.custom as Record<string, unknown> | undefined
        const createdAt =
          typeof custom?.createdAt === 'number'
            ? (custom.createdAt as number)
            : it?.lastMessageAt?.getTime()
        return {
          id,
          title: it?.title?.trim() || 'New chat',
          createdAt,
          isActive: id === mainThreadId,
        }
      })
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }, [threadIds, threadItems, mainThreadId])
}

const DAY = 86_400_000

/** Groups items into Today / Yesterday / Previous 7 days / Older buckets. */
function groupByDate(
  items: ConversationItem[]
): { label: string; items: ConversationItem[] }[] {
  const now = new Date()
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime()

  const buckets: Record<string, ConversationItem[]> = {
    Today: [],
    Yesterday: [],
    'Previous 7 days': [],
    Older: [],
  }

  for (const item of items) {
    const ts = item.createdAt
    if (ts === undefined) {
      buckets.Older.push(item)
      continue
    }
    if (ts >= startOfToday) buckets.Today.push(item)
    else if (ts >= startOfToday - DAY) buckets.Yesterday.push(item)
    else if (ts >= startOfToday - 7 * DAY) buckets['Previous 7 days'].push(item)
    else buckets.Older.push(item)
  }

  return Object.entries(buckets)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, items: list }))
}

interface ThreadRowProps {
  item: ConversationItem
  onSelect?: () => void
  /** Show hover archive/delete actions (rail); off for the compact welcome list. */
  showActions?: boolean
}

/** One conversation row — shared across the rail and the welcome recent list. */
export function ThreadRow({
  item,
  onSelect,
  showActions = true,
}: ThreadRowProps) {
  const runtime = useAssistantRuntime()

  const select = () => {
    void runtime.threads.switchToThread(item.id)
    onSelect?.()
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-lg transition-colors',
        item.isActive ? 'bg-muted' : 'hover:bg-muted focus-within:bg-muted'
      )}
    >
      <button
        type="button"
        onClick={select}
        className="min-w-0 flex-1 truncate px-3 py-2 text-left"
      >
        <div className="truncate text-[12.5px] font-medium">{item.title}</div>
        {item.createdAt !== undefined && (
          <div className="text-muted-foreground truncate text-[10.5px] tabular-nums">
            {formatRelativeTime(item.createdAt)}
          </div>
        )}
      </button>
      {showActions && (
        <div className="mr-1.5 flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <TooltipIconButton
            tooltip="Archive"
            className="hover:text-foreground text-muted-foreground size-7 p-0"
            onClick={() => void runtime.threads.getItemById(item.id).archive()}
          >
            <ArchiveIcon className="size-4" />
          </TooltipIconButton>
          <TooltipIconButton
            tooltip="Delete"
            className="hover:text-destructive text-muted-foreground size-7 p-0"
            onClick={() => void runtime.threads.getItemById(item.id).delete()}
          >
            <Trash2Icon className="size-4" />
          </TooltipIconButton>
        </div>
      )}
    </div>
  )
}

interface ConversationRailBodyProps {
  /** Called after a row is selected or a new chat starts (closes the mobile Drawer). */
  onNavigate?: () => void
  onCollapse?: () => void
  /** Hide the collapse button (mobile Drawer supplies its own close). */
  showCollapse?: boolean
}

/** Header + search + grouped list — the reusable inner body of the rail. */
export function ConversationRailBody({
  onNavigate,
  onCollapse,
  showCollapse = true,
}: ConversationRailBodyProps) {
  const runtime = useAssistantRuntime()
  const items = useConversationItems()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.title.toLowerCase().includes(q))
  }, [items, query])

  const groups = useMemo(() => groupByDate(filtered), [filtered])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <h2 className="text-[13px] font-semibold tracking-tight">
          Conversations
        </h2>
        {showCollapse && onCollapse && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onCollapse}
            className="text-muted-foreground hover:text-foreground size-7 shrink-0"
            aria-label="Collapse conversations"
          >
            <PanelLeftCloseIcon className="size-3.5" />
          </Button>
        )}
      </div>

      <div className="px-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void runtime.threads.switchToNewThread()
            onNavigate?.()
          }}
          className="mb-2 h-8 w-full justify-start gap-2 text-[12.5px]"
        >
          <PlusIcon className="size-3.5" />
          New chat
        </Button>

        <div className="relative mb-2">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            className="bg-background border-input focus-visible:ring-ring h-8 w-full rounded-md border pl-8 pr-2 text-[12.5px] outline-none focus-visible:ring-2"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-3">
          {groups.length === 0 ? (
            <p className="text-muted-foreground px-2 py-8 text-center text-[12px]">
              {query.trim()
                ? 'No conversations match your search.'
                : 'No conversations yet. Start one above.'}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mb-2">
                <div className="text-muted-foreground px-2 py-1 text-[10px] font-semibold tracking-wider uppercase">
                  {group.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <ThreadRow
                      key={item.id}
                      item={item}
                      onSelect={onNavigate}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

interface ConversationRailProps {
  /** Desktop inline column open/closed. */
  open: boolean
  onCollapse: () => void
}

/**
 * Desktop inline collapsible rail column. Mirrors the settings sidebar's width
 * animation so the chat column reserves its space without layout shift.
 */
export function ConversationRail({ open, onCollapse }: ConversationRailProps) {
  return (
    <aside
      className={cn(
        'bg-card border-border shrink-0 overflow-hidden border-r transition-all duration-200',
        open ? 'w-[280px] opacity-100' : 'pointer-events-none w-0 opacity-0'
      )}
      style={{ maxHeight: 'calc(100dvh - 6rem)' }}
    >
      <div className="h-full w-[280px]">
        <ConversationRailBody onCollapse={onCollapse} />
      </div>
    </aside>
  )
}

/** Small trigger button shown in the chat column when the rail is collapsed. */
export function ConversationRailOpenButton({
  onClick,
  className,
}: {
  onClick: () => void
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 gap-1.5 bg-background px-2.5 text-[11.5px] whitespace-nowrap shadow-sm dark:bg-background dark:hover:bg-muted',
        className
      )}
    >
      <MessagesSquareIcon className="size-3.5" />
      Conversations
    </Button>
  )
}
