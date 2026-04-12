import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function ReportsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-24" />

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-32 shrink-0" />
        ))}
      </div>

      {/* Active tab content */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-44" />
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-44" />
            <Skeleton className="h-9 w-16" />
            <Skeleton className="h-9 w-24" />
          </div>

          {/* Chart placeholder */}
          <Skeleton className="h-64 w-full" />

          {/* Table */}
          <div className="space-y-0">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full mt-1" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
