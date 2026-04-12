"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function MemberError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Member portal error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground text-sm max-w-md text-center">
        An error occurred. Please try again or go back to the dashboard.
      </p>
      <Button onClick={reset}>Try Again</Button>
    </div>
  );
}
