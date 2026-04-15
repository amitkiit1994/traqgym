"use client";

import { ChevronUp, ChevronDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";

interface SortableTableHeadProps {
  field: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSort: (field: string) => void;
  children: React.ReactNode;
  className?: string;
}

function SortableTableHead({
  field,
  sortBy,
  sortOrder,
  onSort,
  children,
  className,
}: SortableTableHeadProps) {
  const isActive = sortBy === field;
  return (
    <TableHead className={className}>
      <button
        type="button"
        className="flex items-center gap-1 hover:text-foreground"
        onClick={() => onSort(field)}
      >
        {children}
        {isActive &&
          (sortOrder === "asc" ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          ))}
      </button>
    </TableHead>
  );
}

export { SortableTableHead };
