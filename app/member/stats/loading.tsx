import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function MemberStatsLoading() {
  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-6">
      {/* Title */}
      <Skeleton className="h-8 w-44" />

      {/* Chart card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
