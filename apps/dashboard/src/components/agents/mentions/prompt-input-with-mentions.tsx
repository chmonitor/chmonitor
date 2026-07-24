'use client'

import { ArrowUpIcon, SquareIcon } from 'lucide-react'

import type { ChangeEvent, KeyboardEvent } from 'react'
import type { AutocompleteItem } from './types'

import { AutocompletePopover } from './autocomplete-popover'
import { getCaretCoordinates } from './caret-position'
import { MentionBadge, SlashCommandBadge } from './mention-badge'
import { resolveMentionContext } from './resolve-mentions'
import { useAutocomplete } from './use-autocomplete'
import { useEffect, useRef, useState } from 'react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { useAutocompleteData } from '@/lib/hooks/use-autocomplete-data'
import { useHostId } from '@/lib/swr/use-host'
import { cn } from '@/lib/utils'

interface PromptInputTextareaWithMentionsProps {
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Called when the resolved message (with mention context) is ready */
  onResolvedSubmit?: (fullText: string) => void
  isLoading?: boolean
  onStop?: () => void
  /** Sync text value for external state management */
  value?: string
  onChange?: (value: string) => void
}

export function PromptInputTextareaWithMentions({
  placeholder = 'Ask about your ClickHouse data... (@ for tables, / for commands)',
  disabled,
  className,
  onResolvedSubmit,
  isLoading = false,
  onStop,
  value: controlledValue,
  onChange: controlledOnChange,
}: PromptInputTextareaWithMentionsProps) {
  const hostId = useHostId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [internalValue, setInternalValue] = useState('')

  const value = controlledValue ?? internalValue
  const setValue = (v: string) => {
    if (controlledOnChange) {
      controlledOnChange(v)
    } else {
      setInternalValue(v)
    }
  }

  const autocomplete = useAutocomplete()
  const { tables, resources, skills, commands } = useAutocompleteData()
  const autocompleteQuery = autocomplete.state.query
  const setAutocompleteFilteredItems = autocomplete.setFilteredItems

  // Build filterable items based on current trigger
  const allItems = ((): AutocompleteItem[] => {
    if (autocomplete.state.trigger === '@') {
      return [...resources, ...tables, ...skills]
    }
    if (autocomplete.state.trigger === '/') {
      return commands.map((cmd) => ({
        id: `cmd-${cmd.name}`,
        type: 'command' as const,
        label: cmd.name,
        description: cmd.description,
        value: cmd.promptTemplate,
        group: 'Commands',
      }))
    }
    return []
  })()

  // Filter items by query
  useEffect(() => {
    const query = autocompleteQuery.toLowerCase()
    const filtered = query
      ? allItems.filter(
          (item) =>
            item.label.toLowerCase().includes(query) ||
            item.description?.toLowerCase().includes(query)
        )
      : allItems
    setAutocompleteFilteredItems(filtered.slice(0, 50))
  }, [autocompleteQuery, allItems, setAutocompleteFilteredItems])

  // Compute anchor position for popover
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
    null
  )
  useEffect(() => {
    if (
      autocomplete.state.isOpen &&
      autocomplete.state.triggerIndex >= 0 &&
      textareaRef.current
    ) {
      const textarea = textareaRef.current
      const rect = textarea.getBoundingClientRect()
      const coords = getCaretCoordinates(
        textarea,
        autocomplete.state.triggerIndex
      )
      setAnchor({
        top: rect.top + coords.top,
        left: rect.left + coords.left,
      })
    } else {
      setAnchor(null)
    }
  }, [autocomplete.state.isOpen, autocomplete.state.triggerIndex])

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.currentTarget.value
    setValue(newValue)
    autocomplete.handleTextChange(newValue, e.currentTarget.selectionStart)
  }

  const handleSubmit = async () => {
    if (!value.trim() || disabled) return

    const resolved = await resolveMentionContext(
      autocomplete.mentions,
      autocomplete.slashCommand,
      value,
      { hostId }
    )

    onResolvedSubmit?.(resolved)

    // Clear state
    setValue('')
    autocomplete.clear()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const handled = autocomplete.handleKeyDown(e)
    if (handled) {
      // If Enter/Tab was handled and there are filtered items, perform selection
      if (
        (e.key === 'Enter' || e.key === 'Tab') &&
        autocomplete.filteredItems.length > 0
      ) {
        const selectedItem =
          autocomplete.filteredItems[autocomplete.state.selectedIndex]
        if (selectedItem) {
          autocomplete.handleSelect(selectedItem, textareaRef, setValue)
        }
      }
      return
    }

    // Normal Enter = submit form
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (isLoading) {
        onStop?.()
        return
      }
      void handleSubmit()
    }
  }

  const handleSelect = (item: AutocompleteItem) => {
    autocomplete.handleSelect(item, textareaRef, setValue)
  }

  const hasMentions =
    autocomplete.mentions.length > 0 || autocomplete.slashCommand !== null
  const canSubmit = value.trim().length > 0 && !disabled
  const buttonDisabled = isLoading ? !onStop : !canSubmit

  const handleActionClick = () => {
    if (isLoading) {
      onStop?.()
      return
    }

    void handleSubmit()
  }

  return (
    <div className="relative">
      <InputGroup className={cn('rounded-lg px-3 py-2', className)}>
        {hasMentions && (
          <InputGroupAddon align="block-start">
            <div className="flex flex-wrap gap-1">
              {autocomplete.slashCommand && (
                <SlashCommandBadge
                  command={autocomplete.slashCommand}
                  onRemove={() => autocomplete.setSlashCommand(null)}
                />
              )}
              {autocomplete.mentions.map((mention) => (
                <MentionBadge
                  key={mention.id}
                  mention={mention}
                  onRemove={autocomplete.removeMention}
                />
              ))}
            </div>
          </InputGroupAddon>
        )}

        <InputGroupTextarea
          ref={textareaRef}
          name="message"
          className="field-sizing-content max-h-48 min-h-10"
          placeholder={placeholder}
          disabled={disabled}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />

        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-sm"
            onClick={handleActionClick}
            disabled={buttonDisabled}
            aria-label={isLoading ? 'Stop response' : 'Send message'}
            className={cn(
              'rounded-full transition-[transform,background-color,color] duration-200 active:scale-[0.92]',
              isLoading
                ? 'bg-foreground text-background hover:bg-foreground/90'
                : canSubmit
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground'
            )}
          >
            {isLoading ? (
              <SquareIcon className="size-3.5 fill-current" />
            ) : (
              <ArrowUpIcon className="size-4" />
            )}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>

      {/* Autocomplete popover */}
      <AutocompletePopover
        open={autocomplete.state.isOpen}
        trigger={autocomplete.state.trigger}
        query={autocomplete.state.query}
        anchor={anchor}
        items={autocomplete.filteredItems}
        selectedIndex={autocomplete.state.selectedIndex}
        onSelect={handleSelect}
        onClose={autocomplete.close}
      />
    </div>
  )
}
