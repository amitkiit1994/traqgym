"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  dismissInsightAction,
  snoozeInsightAction,
  executeInsightAction,
} from "@/lib/actions/insights";

export type InsightCardData = {
  id: number;
  agent: string;
  severity: string;
  title: string;
  body: string;
  suggestedActions: Array<{
    label: string;
    action: string;
    args: Record<string, unknown>;
  }>;
  createdAt: string;
};

type Props = {
  insights: InsightCardData[];
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function severityBadgeClass(severity: string): string {
  switch (severity) {
    case "critical":
      return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
    case "high":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
    case "medium":
      return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
    case "low":
      return "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function InsightCardsClient({ insights }: Props) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ordered = [...insights].sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity] ?? 99;
    const sb = SEVERITY_RANK[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  function handleDismiss(insightId: number) {
    setError(null);
    setBusyId(insightId);
    startTransition(async () => {
      const res = await dismissInsightAction({ insightId });
      if (!res.success) setError(res.error);
      setBusyId(null);
    });
  }

  function handleSnooze(insightId: number, hours: number) {
    setError(null);
    setBusyId(insightId);
    const until = new Date(Date.now() + hours * 60 * 60 * 1000);
    startTransition(async () => {
      const res = await snoozeInsightAction({
        insightId,
        untilIso: until.toISOString(),
      });
      if (!res.success) setError(res.error);
      setBusyId(null);
    });
  }

  function handleAction(insightId: number, actionIndex: number) {
    setError(null);
    setBusyId(insightId);
    startTransition(async () => {
      const res = await executeInsightAction({ insightId, actionIndex });
      if (!res.success) setError(res.error);
      setBusyId(null);
    });
  }

  return (
    <section aria-label="Agent insights" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-medium">Agent insights</h2>
        <span className="text-xs text-muted-foreground">
          {ordered.length} active
        </span>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ordered.map((insight) => {
          const isBusy = pending && busyId === insight.id;
          return (
            <Card
              key={insight.id}
              className="bg-popover/85 backdrop-blur-xl backdrop-saturate-[1.3] dark:bg-popover/95"
            >
              <CardHeader className="grid grid-cols-[1fr_auto] items-start gap-2">
                <CardTitle className="text-sm leading-snug">
                  {insight.title}
                </CardTitle>
                <Badge
                  variant="outline"
                  className={severityBadgeClass(insight.severity)}
                >
                  {SEVERITY_LABEL[insight.severity] ?? insight.severity}
                </Badge>
              </CardHeader>

              <CardContent className="space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-line">
                  {insight.body}
                </p>

                {insight.suggestedActions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {insight.suggestedActions.map((a, idx) => {
                      // "navigate" actions just link out; other actions hit the dispatcher.
                      if (a.action === "navigate" && typeof a.args?.href === "string") {
                        return (
                          <a
                            key={idx}
                            href={a.args.href as string}
                            className="inline-flex h-7 items-center rounded-md border border-border bg-background/80 px-2.5 text-[0.8rem] font-medium hover:bg-muted"
                          >
                            {a.label}
                          </a>
                        );
                      }
                      return (
                        <Button
                          key={idx}
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => handleAction(insight.id, idx)}
                        >
                          {a.label}
                        </Button>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center gap-1.5 pt-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={isBusy}
                    onClick={() => handleSnooze(insight.id, 24)}
                  >
                    Snooze 24h
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={isBusy}
                    onClick={() => handleSnooze(insight.id, 24 * 7)}
                  >
                    Snooze 7d
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={isBusy}
                    onClick={() => handleDismiss(insight.id)}
                    className="ml-auto text-muted-foreground"
                  >
                    Dismiss
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
