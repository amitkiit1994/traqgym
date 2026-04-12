import { Skeleton } from "@/components/ui/skeleton";

export default function MembersLoading() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-7 w-28" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-9 w-full sm:w-[250px]" />
        <div className="flex gap-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-16" />
          ))}
        </div>
      </div>

      {/* Table Header */}
      <div className="space-y-0">
        <Skeleton className="h-10 w-full" />
        {/* Table Rows */}
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full mt-1" />
        ))}
      </div>
    </div>
  );
}
