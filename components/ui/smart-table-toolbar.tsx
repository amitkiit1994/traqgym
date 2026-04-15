"use client";

import { cn } from "@/lib/utils";

interface SmartTableToolbarProps {
  children: React.ReactNode;
  className?: string;
}

function SmartTableToolbar({ children, className }: SmartTableToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      {children}
    </div>
  );
}

export { SmartTableToolbar };
