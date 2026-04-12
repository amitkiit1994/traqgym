import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function BalanceDueLoading() {
  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header + location filter */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-2 items-center">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-9 w-48" />
        </div>
      </div>

      {/* Summary + Table card */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-5 w-20 ml-auto" />
        </CardHeader>
        <CardContent>
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
