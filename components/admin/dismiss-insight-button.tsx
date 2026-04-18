"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { dismissInsightAction } from "@/lib/actions/insights";

export function DismissInsightButton({ id }: { id: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleDismiss = () => {
    startTransition(async () => {
      const res = await dismissInsightAction({ insightId: id });
      if (res.success) {
        router.refresh();
      }
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={isPending}
      onClick={handleDismiss}
    >
      {isPending ? "Dismissing…" : "Dismiss"}
    </Button>
  );
}
