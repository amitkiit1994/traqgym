/**
 * Dashboard insight strip.
 *
 * Renders agent-emitted insights surfaced via InAppNotification rows
 * (type === "insight" or title startsWith "[KEY:"). Each card shows a short
 * excerpt of the insight body and a Dismiss button that marks the underlying
 * notification read so it disappears.
 *
 * TODO(PR-3-insight-table): replace InAppNotification reads with first-class
 * Insight table queries once that schema lands in PR 3.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { DismissInsightButton } from "./dismiss-insight-button";

type Severity = "critical" | "high" | "medium" | "low" | "info";

type InsightCard = {
  id: number;
  severity: Severity;
  title: string;
  body: string;
  link: string | null;
  createdAt: Date;
};

const SEVERITY_BADGE: Record<Severity, "destructive" | "expiring" | "info" | "outline"> = {
  critical: "destructive",
  high: "destructive",
  medium: "expiring",
  low: "info",
  info: "outline",
};

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const KEY_PREFIX_RE = /^\[KEY:[^\]]+\]\s*/;
const SEVERITY_BODY_RE = /^\[(CRITICAL|HIGH|MEDIUM|LOW|INFO)\]\s*/i;

function parseInsight(row: {
  id: number;
  title: string;
  message: string | null;
  link: string | null;
  createdAt: Date;
}): InsightCard {
  const cleanTitle = row.title.replace(KEY_PREFIX_RE, "").trim();
  const rawBody = row.message ?? "";
  let severity: Severity = "info";
  let body = rawBody;

  const sevMatch = rawBody.match(SEVERITY_BODY_RE);
  if (sevMatch) {
    severity = sevMatch[1].toLowerCase() as Severity;
    body = rawBody.slice(sevMatch[0].length).trim();
  }

  // Truncate body to first paragraph or 240 chars.
  const firstParagraph = body.split(/\n+/)[0] ?? "";
  const excerpt =
    firstParagraph.length > 240
      ? `${firstParagraph.slice(0, 240).trimEnd()}…`
      : firstParagraph;

  return {
    id: row.id,
    severity,
    title: cleanTitle || "Insight",
    body: excerpt,
    link: row.link,
    createdAt: row.createdAt,
  };
}

export async function InsightCards() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") return null;

  const workerId = parseInt(session.user.id, 10);
  if (!Number.isFinite(workerId)) return null;

  const rows = await prisma.inAppNotification.findMany({
    where: {
      workerId,
      readAt: null,
      OR: [{ type: "insight" }, { title: { startsWith: "[KEY:" } }],
    },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      id: true,
      title: true,
      message: true,
      link: true,
      createdAt: true,
    },
  });

  if (rows.length === 0) return null;

  const insights = rows
    .map(parseInsight)
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        b.createdAt.getTime() - a.createdAt.getTime()
    )
    .slice(0, 6);

  return (
    <section aria-label="Insights" className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Insights
        </h2>
        <Link
          href="/admin/in-app-notifications"
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {insights.map((insight) => (
          <Card
            key={insight.id}
            size="sm"
            className="bg-popover/85 backdrop-blur-xl backdrop-saturate-[1.3] dark:bg-popover/95"
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm leading-snug">
                  {insight.link ? (
                    <Link
                      href={insight.link}
                      className="hover:underline underline-offset-4"
                    >
                      {insight.title}
                    </Link>
                  ) : (
                    insight.title
                  )}
                </CardTitle>
                <Badge variant={SEVERITY_BADGE[insight.severity]}>
                  {insight.severity}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {insight.body && (
                <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-line">
                  {insight.body}
                </p>
              )}
              <div className="flex items-center justify-end">
                <DismissInsightButton id={insight.id} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
