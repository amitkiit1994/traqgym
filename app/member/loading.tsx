import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function MemberHomeLoading() {
  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-6">
      {/* Title */}
      <Skeleton className="h-8 w-48" />

      {/* Hero Card */}
      <Card>
        <CardContent className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 py-5">
          <div className="flex flex-col items-center justify-center shrink-0">
            <Skeleton className="h-10 w-14" />
            <Skeleton className="h-3 w-12 mt-1" />
          </div>
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-44" />
          </div>
          <Skeleton className="h-6 w-24 shrink-0" />
        </CardContent>
      </Card>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-3 py-3 px-4">
              <Skeleton className="size-5 rounded-full shrink-0" />
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-10" />
                <Skeleton className="h-3 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Attendance Streak */}
      <Card>
        <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 py-4 px-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <Skeleton className="h-3 w-3" />
                <Skeleton className="size-6 rounded-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Membership History */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-44" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between border-b pb-2 last:border-0">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              {i === 0 && <Skeleton className="h-5 w-14" />}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Recent Payments */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between border-b pb-2 last:border-0">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
              <div className="space-y-1.5 text-right">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Recent Attendance */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-44" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
