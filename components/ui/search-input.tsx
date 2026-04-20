"use client"

import { useRef, useState, useCallback } from "react"
import { Search, X, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface SearchInputProps {
  placeholder?: string
  onSearch: (query: string) => void
  defaultValue?: string
  isPending?: boolean
  debounceMs?: number
  className?: string
}

function SearchInput({
  placeholder = "Search...",
  onSearch,
  defaultValue = "",
  isPending = false,
  debounceMs = 300,
  className,
}: SearchInputProps) {
  const [value, setValue] = useState(defaultValue)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const debouncedSearch = useCallback(
    (q: string) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => onSearch(q), debounceMs)
    },
    [onSearch, debounceMs]
  )

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setValue(val)
    debouncedSearch(val)
  }

  const handleClear = () => {
    setValue("")
    if (timerRef.current) clearTimeout(timerRef.current)
    onSearch("")
  }

  return (
    <div data-slot="search-input" className={cn("relative", className)}>
      <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center justify-center text-muted-foreground">
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Search className="size-4" />
        )}
      </div>
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        className={cn("pl-8", value ? "pr-8" : "")}
      />
      {value && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          className="absolute inset-y-0 right-2.5 flex items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

export { SearchInput }
