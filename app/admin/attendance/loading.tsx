import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function AttendanceLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-28" />

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-36" />
      </div>

      {/* Filters: Date + Location + Export */}
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 sm:items-end sm:flex-wrap">
        <div className="space-y-1">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="space-y-1">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-44" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-2 sm:gap-4">
        <Skeleton className="h-9 w-40 rounded-lg" />
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      {/* Table */}
      <div className="space-y-0">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full mt-1" />
        ))}
      </div>

      {/* Manual check-in card */}
      <Card className="max-w-md">
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-9 w-24" />
        </CardContent>
      </Card>
    </div>
  );
}
