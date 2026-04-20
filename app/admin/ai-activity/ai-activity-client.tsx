"use client";

import { useEffect, useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Bot,
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Settings,
} from "lucide-react";
import {
  getAiActivitySummary,
  getAiSettings,
  updateAiSetting,
} from "@/lib/actions/ai-activity";

const featureLabels: Record<string, string> = {
  daily_briefing: "Daily Briefing",
  churn_alert: "Churn Alerts",
  lead_followup: "Lead Follow-up",
  member_nudge: "Member Nudges",
  smart_renewal: "Smart Renewal",
  milestone: "Milestones",
  weekly_summary: "Weekly Summary",
  draft_followup: "Follow-up Drafts",
};

const settingLabels: Record<string, string> = {
  ai_daily_briefing_enabled: "Daily AI Briefing",
  ai_churn_alerts_enabled: "Churn Alerts",
  ai_lead_followup_enabled: "Smart Lead Follow-up",
  ai_member_nudges_enabled: "Member Workout Nudges",
  ai_smart_renewal_enabled: "AI Smart Renewal",
  member_milestones_enabled: "Milestone Celebrations",
};

export function AiActivityClient() {
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof getAiActivitySummary>
  > | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<"activity" | "settings">("activity");

  useEffect(() => {
    Promise.all([getAiActivitySummary(), getAiSettings()]).then(
      ([s, settings]) => {
        setSummary(s);
        setSettings(settings);
      }
    );
  }, []);

  function toggleSetting(key: string) {
    const newValue = settings[key] === "true" ? "false" : "true";
    setSettings((prev) => ({ ...prev, [key]: newValue }));
    startTransition(async () => {
      await updateAiSetting(key, newValue);
    });
  }

  function timeAgo(date: Date | string) {
    const d = new Date(date);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  if (!summary) {
    return (
      <div className="space-y-4 md:space-y-6">
        <h1 className="text-xl md:text-2xl font-bold">AI Activity</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const sentCount =
    summary.byStatus.find((s) => s.status === "sent")?.count ?? 0;
  const failedCount =
    summary.byStatus.find((s) => s.status === "failed")?.count ?? 0;

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
          <Bot className="size-6 text-primary" />
          AI Activity
        </h1>
        <div className="inline-flex items-center rounded-md border bg-muted/40 p-1">
          <Button
            variant={tab === "activity" ? "default" : "ghost"}
            size="sm"
            onClick={() => setTab("activity")}
            className="h-8"
            aria-pressed={tab === "activity"}
          >
            <Zap className="size-4 mr-1" />
            Activity
          </Button>
          <Button
            variant={tab === "settings" ? "default" : "ghost"}
            size="sm"
            onClick={() => setTab("settings")}
            className="h-8"
            aria-pressed={tab === "settings"}
          >
            <Settings className="size-4 mr-1" />
            AI Settings
          </Button>
        </div>
      </div>

      {tab === "activity" && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="gradient-border-card">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold stat-value-glow">
                  {summary.totalThisWeek}
                </div>
                <p className="text-sm text-muted-foreground">
                  Actions this week
                </p>
              </CardContent>
            </Card>
            <Card className="gradient-border-card">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-green-500">
                  {sentCount}
                </div>
                <p className="text-sm text-muted-foreground">Sent</p>
              </CardContent>
            </Card>
            <Card className="gradient-border-card">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-destructive">
                  {failedCount}
                </div>
                <p className="text-sm text-muted-foreground">Failed</p>
              </CardContent>
            </Card>
            <Card className="gradient-border-card">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">
                  {summary.totalTokens.toLocaleString()}
                </div>
                <p className="text-sm text-muted-foreground">Tokens used</p>
              </CardContent>
            </Card>
          </div>

          {/* By Feature */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">By Feature</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {summary.byFeature.map((f) => (
                  <div
                    key={f.feature}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <span className="font-medium">
                      {featureLabels[f.feature] ?? f.feature}
                    </span>
                    <Badge variant="secondary">{f.count}</Badge>
                  </div>
                ))}
                {summary.byFeature.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No AI activity this week
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feature</TableHead>
                    <TableHead className="hidden sm:table-cell">Target</TableHead>
                    <TableHead className="hidden md:table-cell">Channel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.recentLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium">
                        {featureLabels[log.feature] ?? log.feature}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">
                        {log.targetType} #{log.targetId}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline" className="text-xs">
                          {log.channel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {log.status === "sent" ? (
                          <CheckCircle2 className="size-4 text-green-500" />
                        ) : log.status === "failed" ? (
                          <XCircle className="size-4 text-destructive" />
                        ) : (
                          <AlertTriangle className="size-4 text-yellow-500" />
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {timeAgo(log.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {summary.recentLogs.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center text-muted-foreground"
                      >
                        No activity yet
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {tab === "settings" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">AI Feature Toggles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(settingLabels).map(([key, label]) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div>
                  <p className="font-medium text-sm">{label}</p>
                  <p className="text-xs text-muted-foreground">
                    {settings[key] === "true" ? "Active" : "Disabled"}
                  </p>
                </div>
                <Button
                  variant={settings[key] === "true" ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleSetting(key)}
                  disabled={isPending}
                >
                  {settings[key] === "true" ? "Enabled" : "Disabled"}
                </Button>
              </div>
            ))}

            <div className="border-t pt-4 mt-4">
              <p className="text-sm font-medium mb-3">Configuration</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="flex justify-between border rounded-lg p-3">
                  <span className="text-muted-foreground">
                    Daily AI budget
                  </span>
                  <span className="font-medium">
                    {settings.ai_proactive_daily_budget ?? "30"} calls/day
                  </span>
                </div>
                <div className="flex justify-between border rounded-lg p-3">
                  <span className="text-muted-foreground">
                    Churn threshold
                  </span>
                  <span className="font-medium">
                    {settings.ai_churn_inactive_days ?? "7"} days inactive
                  </span>
                </div>
                <div className="flex justify-between border rounded-lg p-3">
                  <span className="text-muted-foreground">
                    Lead follow-up gap
                  </span>
                  <span className="font-medium">
                    {settings.ai_lead_followup_gap_hours ?? "48"} hours
                  </span>
                </div>
                <div className="flex justify-between border rounded-lg p-3">
                  <span className="text-muted-foreground">
                    Member nudge threshold
                  </span>
                  <span className="font-medium">
                    {settings.ai_member_nudge_inactive_days ?? "5"} days
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
