import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function MemberClassesLoading() {
  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-4">
      {/* Title */}
      <Skeleton className="h-7 w-24" />

      {/* Day selector pills */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-md shrink-0" />
        ))}
      </div>

      {/* Classes card with table skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent>
          {/* Desktop table */}
          <div className="hidden md:block space-y-0">
            <div className="flex gap-4 py-3 border-b">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-4 py-3 border-b last:border-0">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
            ))}
          </div>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-10" />
                </div>
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-8 w-full rounded-md" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* My Upcoming Bookings card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-44" />
        </CardHeader>
        <CardContent>
          <div className="hidden md:block space-y-0">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex gap-4 py-3 border-b last:border-0">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
            ))}
          </div>
          <div className="md:hidden space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-full rounded-md" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
