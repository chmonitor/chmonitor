import { Search, X } from 'lucide-react'

interface TableSearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
}

export function TableSearchInput({
  value,
  onChange,
  placeholder,
}: TableSearchInputProps) {
  return (
    <div className="flex h-8 min-w-[160px] flex-1 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 sm:w-64 sm:flex-none md:w-72">
      <Search className="size-3.5 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
