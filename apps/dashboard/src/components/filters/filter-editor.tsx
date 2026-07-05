import { CheckIcon, Loader2Icon, PlusIcon } from 'lucide-react'

import type { KeyboardEvent } from 'react'
import type { FilterField, FilterOperator } from '@/lib/filters/types'

import { useState } from 'react'
import { useFilterOptions } from '@/components/filters/use-filter-options'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { OPERATORS } from '@/lib/filters/operators'
import { useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

/** A draft filter being edited (operator + raw values, before serialization). */
export interface FilterDraft {
  operator: FilterOperator
  values: string[]
}

interface FilterEditorProps {
  field: FilterField
  configName: string
  /** Existing filter being edited; omitted when adding a new filter. */
  initial?: FilterDraft
  onSubmit: (draft: FilterDraft) => void
  onCancel: () => void
}

/** Validate that a draft has enough values for its operator. */
function isDraftValid(operator: FilterOperator, values: string[]): boolean {
  const { arity } = OPERATORS[operator]
  if (arity === 'multi') return values.some((v) => v.trim().length > 0)
  if (arity === 2) return Boolean(values[0]?.trim() && values[1]?.trim())
  return Boolean(values[0]?.trim())
}

/** Coerce a draft's values to the exact shape its operator expects. */
function normalizeValues(operator: FilterOperator, values: string[]): string[] {
  const { arity } = OPERATORS[operator]
  if (arity === 'multi') return values.filter((v) => v.trim().length > 0)
  if (arity === 2) return [values[0] ?? '', values[1] ?? '']
  return [values[0] ?? '']
}

/**
 * Popover body for adding or editing a single filter. Renders an operator
 * picker plus a value editor whose shape adapts to the field type and the
 * selected operator (text, number, range, relative time, or option list).
 */
export function FilterEditor({
  field,
  configName,
  initial,
  onSubmit,
  onCancel,
}: FilterEditorProps) {
  const [operator, setOperator] = useState<FilterOperator>(
    initial?.operator ?? field.operators[0]
  )
  const [values, setValues] = useState<string[]>(initial?.values ?? [])

  const valid = isDraftValid(operator, values)
  const submit = () => {
    if (valid) onSubmit({ operator, values: normalizeValues(operator, values) })
  }

  const FieldIcon = field.icon

  return (
    <div className="flex w-72 flex-col gap-3">
      <div className="flex items-center gap-2">
        {FieldIcon && <FieldIcon className="size-4 text-muted-foreground" />}
        <span className="text-sm font-medium">{field.label}</span>
      </div>

      {field.operators.length > 1 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Condition</span>
          <Select
            value={operator}
            onValueChange={(value) => setOperator(value as FilterOperator)}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.operators.map((op) => (
                <SelectItem key={op} value={op}>
                  {OPERATORS[op].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <FilterValueInput
        field={field}
        operator={operator}
        values={values}
        onChange={setValues}
        onSubmit={submit}
        configName={configName}
      />

      {field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-8" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" className="h-8" onClick={submit} disabled={!valid}>
          Apply
        </Button>
      </div>
    </div>
  )
}

interface FilterValueInputProps {
  field: FilterField
  operator: FilterOperator
  values: string[]
  onChange: (values: string[]) => void
  onSubmit: () => void
  configName: string
}

/** Renders the value editor appropriate for the field type + operator. */
function FilterValueInput({
  field,
  operator,
  values,
  onChange,
  onSubmit,
  configName,
}: FilterValueInputProps) {
  const { arity } = OPERATORS[operator]

  // Multi-value option list (in / notIn) — always a select field.
  if (arity === 'multi') {
    return (
      <OptionsList
        field={field}
        configName={configName}
        multiple
        selected={values}
        onChange={onChange}
      />
    )
  }

  // Range (between) — two single inputs.
  if (arity === 2) {
    return (
      <div className="flex items-center gap-2">
        <SingleValueInput
          field={field}
          operator={operator}
          value={values[0] ?? ''}
          placeholder="From"
          onChange={(v) => onChange([v, values[1] ?? ''])}
          onSubmit={onSubmit}
        />
        <span className="text-xs text-muted-foreground">and</span>
        <SingleValueInput
          field={field}
          operator={operator}
          value={values[1] ?? ''}
          placeholder="To"
          onChange={(v) => onChange([values[0] ?? '', v])}
          onSubmit={onSubmit}
        />
      </div>
    )
  }

  // Single option pick (is / is not) on a select field.
  if (field.type === 'select' && (operator === 'eq' || operator === 'ne')) {
    return (
      <OptionsList
        field={field}
        configName={configName}
        multiple={false}
        selected={values}
        onChange={onChange}
      />
    )
  }

  // Single free-form value.
  return (
    <SingleValueInput
      field={field}
      operator={operator}
      value={values[0] ?? ''}
      onChange={(v) => onChange([v])}
      onSubmit={onSubmit}
    />
  )
}

interface SingleValueInputProps {
  field: FilterField
  operator: FilterOperator
  value: string
  placeholder?: string
  onChange: (value: string) => void
  onSubmit: () => void
}

/** A single value editor: relative-time select, datetime, number, or text. */
function SingleValueInput({
  field,
  operator,
  value,
  placeholder,
  onChange,
  onSubmit,
}: SingleValueInputProps) {
  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onSubmit()
    }
  }

  // Relative time window — pick from the field's preset options.
  if (field.type === 'datetime' && operator === 'withinHours') {
    return (
      <Select
        value={value}
        onValueChange={(v) => {
          if (v != null) onChange(v)
        }}
      >
        <SelectTrigger className="h-8 flex-1">
          <SelectValue placeholder="Select range" />
        </SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === 'datetime') {
    return (
      <Input
        type="datetime-local"
        className="h-8 flex-1"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={submitOnEnter}
      />
    )
  }

  if (field.type === 'number') {
    return (
      <InputGroup className="h-8 flex-1">
        <InputGroupInput
          type="number"
          placeholder={placeholder ?? field.placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={submitOnEnter}
        />
        {field.unit && (
          <InputGroupAddon
            align="inline-end"
            className="text-xs text-muted-foreground"
          >
            {field.unit}
          </InputGroupAddon>
        )}
      </InputGroup>
    )
  }

  return (
    <Input
      className="h-8 flex-1"
      placeholder={placeholder ?? field.placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={submitOnEnter}
    />
  )
}

interface OptionsListProps {
  field: FilterField
  configName: string
  multiple: boolean
  selected: string[]
  onChange: (values: string[]) => void
}

/**
 * Searchable option list for `select` fields. Options come either from the
 * field's static list or are loaded live from ClickHouse. A value typed into
 * the search box that matches nothing can still be used as a custom value.
 */
function OptionsList({
  field,
  configName,
  multiple,
  selected,
  onChange,
}: OptionsListProps) {
  const hostId = useHostId()
  const isDynamic = Boolean(field.dynamicOptions)
  const {
    options: dynamicOptions,
    isLoading,
    error,
  } = useFilterOptions(configName, field.key, hostId, isDynamic)
  const options = isDynamic ? dynamicOptions : (field.options ?? [])
  const [search, setSearch] = useState('')

  const toggle = (value: string) => {
    if (!multiple) {
      onChange([value])
      return
    }
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    )
  }

  const trimmedSearch = search.trim()
  const showCustomValue =
    trimmedSearch.length > 0 &&
    !options.some(
      (option) => option.value.toLowerCase() === trimmedSearch.toLowerCase()
    )

  return (
    <Command className="rounded-md border" shouldFilter>
      <CommandInput
        placeholder="Search or type a value..."
        value={search}
        onValueChange={setSearch}
        className="h-9"
      />
      <CommandList className="max-h-44">
        {error && (
          <div className="px-2 py-3 text-xs text-amber-600 dark:text-amber-400">
            Failed to load values: showing cached results
          </div>
        )}
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            Loading values…
          </div>
        )}
        {!isLoading && <CommandEmpty>No matching values</CommandEmpty>}
        <CommandGroup>
          {options.map((option) => (
            <CommandItem
              key={option.value}
              value={option.value}
              onSelect={() => toggle(option.value)}
            >
              <CheckIcon
                className={cn(
                  'size-4',
                  selected.includes(option.value) ? 'opacity-100' : 'opacity-0'
                )}
              />
              <span className="truncate">{option.label}</span>
            </CommandItem>
          ))}
          {showCustomValue && (
            <CommandItem
              value={trimmedSearch}
              onSelect={() => {
                toggle(trimmedSearch)
                setSearch('')
              }}
            >
              <PlusIcon className="size-4" />
              Use “{trimmedSearch}”
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
      {multiple && selected.length > 0 && (
        <div className="border-t px-2 py-1.5 text-xs text-muted-foreground">
          {selected.length} selected
        </div>
      )}
    </Command>
  )
}
