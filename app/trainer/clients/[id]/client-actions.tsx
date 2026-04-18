"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2 } from "lucide-react";
import { completePtSessionAction } from "@/lib/actions/pt";

export function CompleteSessionButton({
  sessionId,
  disabled,
}: {
  sessionId: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await completePtSessionAction(sessionId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={onClick}
        disabled={disabled || pending}
        className="gap-1"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="size-3.5" />
        )}
        Mark complete
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
