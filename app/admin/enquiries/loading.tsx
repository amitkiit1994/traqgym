import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function EnquiriesLoading() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>

      {/* Status filters */}
      <div className="flex gap-2 flex-wrap">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20" />
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="space-y-0">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full mt-1" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
