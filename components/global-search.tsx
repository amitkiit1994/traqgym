"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { globalSearch, type SearchResultItem } from "@/lib/actions/search";
import { Input } from "@/components/ui/input";
import { Users, UserCog, CreditCard, CalendarDays, MessageSquare, Clock } from "lucide-react";

const categoryConfig: Record<SearchResultItem["category"], { label: string; icon: typeof Users }> = {
  member: { label: "Members", icon: Users },
  worker: { label: "Staff", icon: UserCog },
  plan: { label: "Plans", icon: CreditCard },
  class: { label: "Classes", icon: CalendarDays },
  enquiry: { label: "Enquiries", icon: MessageSquare },
};

const RECENT_SEARCHES_KEY = "traqgym-recent-searches";
const MAX_RECENT = 5;

function getRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(q: string) {
  const trimmed = q.trim();
  if (!trimmed) return;
  const existing = getRecentSearches();
  const updated = [trimmed, ...existing.filter((s) => s !== trimmed)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
}

function clearRecentSearches() {
  localStorage.removeItem(RECENT_SEARCHES_KEY);
}

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const data = await globalSearch(q);
    setResults(data);
    setOpen(true);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setHighlightedIndex(-1);
    if (val === "") {
      setOpen(false);
      setResults([]);
      const recent = getRecentSearches();
      setRecentSearches(recent);
      setShowRecent(recent.length > 0);
      return;
    }
    setShowRecent(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 300);
  };

  const handleSelect = (item: SearchResultItem) => {
    saveRecentSearch(query);
    setOpen(false);
    setShowRecent(false);
    setQuery("");
    setResults([]);
    setHighlightedIndex(-1);
    router.push(item.href);
  };

  const handleRecentClick = (recent: string) => {
    setQuery(recent);
    setShowRecent(false);
    setHighlightedIndex(-1);
    doSearch(recent);
  };

  const handleClearRecent = () => {
    clearRecentSearches();
    setRecentSearches([]);
    setShowRecent(false);
  };

  const handleFocus = () => {
    if (query === "") {
      const recent = getRecentSearches();
      setRecentSearches(recent);
      if (recent.length > 0) setShowRecent(true);
    } else if (results.length > 0) {
      setOpen(true);
    }
  };

  // Group results by category
  const grouped = results.reduce<Record<string, SearchResultItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  // Flatten grouped results for arrow key indexing
  const flatResults = Object.entries(grouped).flatMap(([, items]) => items);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      setShowRecent(false);
      setHighlightedIndex(-1);
      inputRef.current?.blur();
      return;
    }

    // Arrow navigation for search results
    if (open && flatResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % flatResults.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev <= 0 ? flatResults.length - 1 : prev - 1));
      } else if (e.key === "Enter" && highlightedIndex >= 0) {
        e.preventDefault();
        handleSelect(flatResults[highlightedIndex]);
      }
      return;
    }

    // Arrow navigation for recent searches
    if (showRecent && recentSearches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % recentSearches.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev <= 0 ? recentSearches.length - 1 : prev - 1));
      } else if (e.key === "Enter" && highlightedIndex >= 0) {
        e.preventDefault();
        handleRecentClick(recentSearches[highlightedIndex]);
      }
    }
  };

  // Reset highlight when results change
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [results]);

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowRecent(false);
        setHighlightedIndex(-1);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative w-72" onKeyDown={handleKeyDown}>
      <div className="relative">
        <Input
          ref={inputRef}
          type="search"
          placeholder="Search... (⌘K)"
          value={query}
          onChange={handleChange}
          onFocus={handleFocus}
          className="h-8 text-sm pr-12"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-flex h-5 items-center rounded border bg-muted px-1 text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md max-h-80 overflow-y-auto">
          {(() => {
            let flatIndex = 0;
            return Object.entries(grouped).map(([category, items]) => {
              const config = categoryConfig[category as SearchResultItem["category"]];
              const Icon = config.icon;
              return (
                <div key={category}>
                  <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground">
                    <Icon className="size-3" />
                    {config.label}
                  </div>
                  {items.map((item) => {
                    const idx = flatIndex++;
                    return (
                      <button
                        key={`${item.category}-${item.id}`}
                        type="button"
                        onClick={() => handleSelect(item)}
                        className={`flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted ${highlightedIndex === idx ? "bg-muted" : ""}`}
                      >
                        <span className="font-medium">{item.label}</span>
                        <span className="text-xs text-muted-foreground">{item.sublabel}</span>
                      </button>
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>
      )}
      {showRecent && recentSearches.length > 0 && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
          <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Recent searches</div>
          {recentSearches.map((recent, idx) => (
            <button
              key={recent}
              type="button"
              onClick={() => handleRecentClick(recent)}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted ${highlightedIndex === idx ? "bg-muted" : ""}`}
            >
              <Clock className="size-3 text-muted-foreground shrink-0" />
              <span>{recent}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={handleClearRecent}
            className="w-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground text-left"
          >
            Clear recent
          </button>
        </div>
      )}
      {open && results.length === 0 && query.length >= 2 && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-md border bg-popover p-2 shadow-md">
          <p className="text-xs text-muted-foreground">No results found</p>
        </div>
      )}
    </div>
  );
}
