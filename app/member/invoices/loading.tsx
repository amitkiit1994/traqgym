import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function MemberInvoicesLoading() {
  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-6">
      {/* Title */}
      <Skeleton className="h-8 w-32" />

      {/* Total paid summary */}
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-20" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-36" />
        </CardContent>
      </Card>

      {/* Search bar */}
      <div className="flex gap-2 max-w-sm">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-16" />
      </div>

      {/* Table */}
      <Card>
        <CardContent>
          {/* Header row */}
          <div className="flex gap-4 py-3 border-b">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20 hidden md:block" />
            <Skeleton className="h-4 w-16 hidden md:block" />
            <Skeleton className="h-4 w-20" />
          </div>
          {/* Data rows */}
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4 py-3 border-b last:border-0">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20 hidden md:block" />
              <Skeleton className="h-4 w-16 hidden md:block" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
