import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function RenewalsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-28" />

      <Card className="max-w-lg">
        <CardHeader>
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Member search */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-9 w-full" />
          </div>
          {/* Plan */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-8 w-full" />
          </div>
          {/* Location */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-full" />
          </div>
          {/* Promo Code */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-16" />
            </div>
          </div>
          {/* Payment Mode */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-full" />
          </div>
          {/* Submit */}
          <Skeleton className="h-9 w-32" />
        </CardContent>
      </Card>
    </div>
  );
}
