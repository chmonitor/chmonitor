'use client'

import type { AutocompleteItem, Mention, SlashCommand } from './types'

import { useRef, useState } from 'react'

// Generate unique IDs using crypto.randomUUID when available (avoids HMR state issues)
function uniqueId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `mention-${crypto.randomUUID()}`
  }
  return `mention-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function areAutocompleteItemsEqual(
  previous: readonly AutocompleteItem[],
  next: readonly AutocompleteItem[]
) {
  return (
    previous.length === next.length &&
    previous.every((item, index) => {
      const nextItem = next[index]
      return (
        item.id === nextItem.id &&
        item.type === nextItem.type &&
        item.label === nextItem.label &&
        item.value === nextItem.value &&
        item.description === nextItem.description &&
        item.group === nextItem.group
      )
    })
  )
}

interface AutocompleteState {
  trigger: '@' | '/' | null
  query: string
  triggerIndex: number
  selectedIndex: number
  isOpen: boolean
}

const INITIAL_STATE: AutocompleteState = {
  trigger: null,
  query: '',
  triggerIndex: -1,
  selectedIndex: 0,
  isOpen: false,
}

export interface UseAutocompleteReturn {
  state: AutocompleteState
  mentions: Mention[]
  slashCommand: SlashCommand | null
  handleTextChange: (value: string, selectionStart: number) => void
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean // returns true if handled
  handleSelect: (
    item: AutocompleteItem,
    textareaRef: React.RefObject<HTMLTextAreaElement | null>,
    setText: (v: string) => void
  ) => void
  removeMention: (id: string) => void
  setSlashCommand: (command: SlashCommand | null) => void
  close: () => void
  clear: () => void
  filteredItems: AutocompleteItem[]
  setFilteredItems: (items: AutocompleteItem[]) => void
}

export function useAutocomplete(): UseAutocompleteReturn {
  const [state, setState] = useState<AutocompleteState>(INITIAL_STATE)
  const [mentions, setMentions] = useState<Mention[]>([])
  const [slashCommand, setSlashCommand] = useState<SlashCommand | null>(null)
  const [filteredItems, setFilteredItems] = useState<AutocompleteItem[]>([])

  // Keep a ref to filteredItems for keyboard handlers to avoid stale closures
  const filteredItemsRef = useRef<AutocompleteItem[]>([])
  const stateRef = useRef<AutocompleteState>(INITIAL_STATE)

  const updateState = (next: AutocompleteState) => {
    stateRef.current = next
    setState(next)
  }

  const updateFilteredItems = (items: AutocompleteItem[]) => {
    if (areAutocompleteItemsEqual(filteredItemsRef.current, items)) return

    filteredItemsRef.current = items
    setFilteredItems(items)
  }

  const close = () => {
    updateState(INITIAL_STATE)
  }

  const clear = () => {
    setMentions([])
    setSlashCommand(null)
    updateState(INITIAL_STATE)
    updateFilteredItems([])
  }

  const handleTextChange = (value: string, selectionStart: number) => {
    // Scan backward from cursor to find a trigger character
    let triggerChar: '@' | '/' | null = null
    let triggerIdx = -1
    let query = ''

    for (let i = selectionStart - 1; i >= 0; i--) {
      const char = value[i]

      if (char === '@') {
        // @ is valid at position 0 or preceded by whitespace
        const preceding = i === 0 ? ' ' : value[i - 1]
        if (/\s/.test(preceding)) {
          triggerChar = '@'
          triggerIdx = i
          query = value.slice(i + 1, selectionStart)
        }
        break
      }

      if (char === '/') {
        // / is valid only at start of input (no non-whitespace before it)
        const before = value.slice(0, i)
        if (/^\s*$/.test(before)) {
          triggerChar = '/'
          triggerIdx = i
          query = value.slice(i + 1, selectionStart)
        }
        break
      }

      // If we hit whitespace that isn't preceded by a trigger, stop
      if (/\s/.test(char)) {
        break
      }
    }

    if (triggerChar !== null) {
      updateState({
        trigger: triggerChar,
        query,
        triggerIndex: triggerIdx,
        selectedIndex: 0,
        isOpen: true,
      })
    } else {
      if (stateRef.current.isOpen) {
        updateState(INITIAL_STATE)
      }
    }
  }

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ): boolean => {
    const current = stateRef.current
    if (!current.isOpen) return false

    const items = filteredItemsRef.current
    const count = items.length

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const next = count > 0 ? (current.selectedIndex + 1) % count : 0
        updateState({ ...current, selectedIndex: next })
        return true
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prev = count > 0 ? (current.selectedIndex - 1 + count) % count : 0
        updateState({ ...current, selectedIndex: prev })
        return true
      }
      case 'Enter':
      case 'Tab': {
        if (count === 0) return false
        e.preventDefault()
        // Caller (AutocompletePopover integration) should call handleSelect
        // We signal "handled" and the parent component calls handleSelect with
        // items[selectedIndex]. Returning true here lets the chat area intercept.
        return true
      }
      case 'Escape': {
        e.preventDefault()
        updateState(INITIAL_STATE)
        return true
      }
      default:
        return false
    }
  }

  const handleSelect = (
    item: AutocompleteItem,
    textareaRef: React.RefObject<HTMLTextAreaElement | null>,
    setText: (v: string) => void
  ) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const current = stateRef.current
    const value = textarea.value
    const cursorPos = textarea.selectionStart ?? value.length

    const replacement =
      item.type === 'command' ? `/${item.label} ` : `@${item.label} `

    const newValue =
      value.slice(0, current.triggerIndex) +
      replacement +
      value.slice(cursorPos)

    setText(newValue)

    const newCursor = current.triggerIndex + replacement.length
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newCursor
        textareaRef.current.selectionEnd = newCursor
      }
    })

    if (item.type === 'command') {
      setSlashCommand({
        name: item.label,
        label: `/${item.label}`,
        description: item.description ?? '',
        promptTemplate: item.value,
      })
    } else {
      setMentions((prev) => {
        // Avoid duplicate mentions
        if (prev.some((m) => m.value === item.value)) return prev
        const parts = item.value.split('.')
        return [
          ...prev,
          {
            id: uniqueId(),
            type: item.type as Mention['type'],
            label: item.label,
            value: item.value,
            database: item.type === 'table' ? parts[0] : undefined,
            table: item.type === 'table' ? parts.slice(1).join('.') : undefined,
          },
        ]
      })
    }

    updateState(INITIAL_STATE)
  }

  const removeMention = (id: string) => {
    setMentions((prev) => prev.filter((m) => m.id !== id))
  }

  return {
    state,
    mentions,
    slashCommand,
    handleTextChange,
    handleKeyDown,
    handleSelect,
    removeMention,
    setSlashCommand,
    close,
    clear,
    filteredItems,
    setFilteredItems: updateFilteredItems,
  }
}
