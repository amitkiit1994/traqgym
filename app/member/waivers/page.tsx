"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getMemberWaiverStatus,
  signMemberWaiver,
} from "@/lib/actions/member-waivers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileCheck } from "lucide-react";

type WaiverItem = {
  id: number;
  name: string;
  content: string;
  required: boolean;
  signed: boolean;
  signedAt: string | null;
};

export default function MemberWaiversPage() {
  const [waivers, setWaivers] = useState<WaiverItem[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getMemberWaiverStatus();
      setWaivers(data);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSign = (templateId: number) => {
    setError("");
    startTransition(async () => {
      const result = await signMemberWaiver(templateId);
      if (!result.success) {
        setError(result.error || "Failed to sign waiver");
      }
      load();
    });
  };

  const signed = waivers.filter((w) => w.signed);
  const unsigned = waivers.filter((w) => !w.signed);

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Waivers</h1>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {waivers.length === 0 && !isPending && (
        <div className="flex flex-col items-center py-12 text-center">
          <FileCheck className="size-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No waivers to sign</p>
        </div>
      )}

      {unsigned.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending Waivers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {unsigned.map((w) => (
              <div
                key={w.id}
                className="border rounded-lg p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{w.name}</p>
                    {w.required && (
                      <Badge variant="destructive">Required</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setExpandedId(expandedId === w.id ? null : w.id)
                      }
                    >
                      {expandedId === w.id ? "Hide" : "Read"}
                    </Button>
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleSign(w.id)}
                    >
                      Sign
                    </Button>
                  </div>
                </div>
                {expandedId === w.id && (
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap border-t pt-2 mt-2">
                    {w.content}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {signed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Signed Waivers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {signed.map((w) => (
              <div
                key={w.id}
                className="border rounded-lg p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{w.name}</p>
                    <Badge variant="default">Signed</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {w.signedAt
                      ? new Date(w.signedAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : ""}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
