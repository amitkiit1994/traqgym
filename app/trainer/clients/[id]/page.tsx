import { notFound } from "next/navigation";
import Link from "next/link";
import { requireTrainer } from "@/lib/auth-guard";
import { getMyClientDetail } from "@/lib/services/trainer-self";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Phone, Activity, NotebookPen } from "lucide-react";
import { CompleteSessionButton } from "./client-actions";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusClass(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    case "scheduled":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
    case "no_show":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "cancelled":
      return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
    case "active":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    case "expired":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    default:
      return "";
  }
}

export default async function TrainerClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const trainer = await requireTrainer();
  const { id } = await params;
  const userId = parseInt(id, 10);
  if (!Number.isFinite(userId)) notFound();

  const detail = await getMyClientDetail(trainer.workerId, userId);
  if (!detail) notFound();

  const allSessions = detail.packages
    .flatMap((p) =>
      p.sessions.map((s) => ({ ...s, packageId: p.id, packageStatus: p.status }))
    )
    .sort(
      (a, b) =>
        new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
    );

  const latestMeasurement = detail.recentMeasurements[0] ?? null;

  return (
    <div className="space-y-4 p-3 md:p-6">
      <div>
        <Link
          href="/trainer/clients"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to clients
        </Link>
        <h1 className="text-2xl font-bold mt-2">{detail.userName}</h1>
        {detail.userPhone && (
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <Phone className="size-3.5" /> {detail.userPhone}
          </p>
        )}
      </div>

      {/* Packages */}
      <div className="space-y-3">
        {detail.packages.map((p) => (
          <Card key={p.id}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">
                Package #{p.id}
              </CardTitle>
              <Badge variant="outline" className={statusClass(p.status)}>
                {p.status}
              </Badge>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Sessions</p>
                <p className="font-semibold">
                  {p.sessionsUsed}/{p.sessionsTotal}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.sessionsRemaining} left
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Started</p>
                <p className="font-semibold">{formatDate(p.startedAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Expires</p>
                <p className="font-semibold">
                  {p.expiresAt ? formatDate(p.expiresAt) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Per session</p>
                <p className="font-semibold">
                  ₹{p.pricePerSession.toLocaleString("en-IN")}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent measurements */}
      {latestMeasurement && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="size-4" /> Body Composition (latest)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-2">
              Recorded {formatDate(latestMeasurement.date)}
            </p>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-sm">
              {([
                ["Weight", latestMeasurement.weight, "kg"],
                ["Height", latestMeasurement.height, "cm"],
                ["BMI", latestMeasurement.bmi, ""],
                ["Chest", latestMeasurement.chest, "cm"],
                ["Waist", latestMeasurement.waist, "cm"],
                ["Hips", latestMeasurement.hips, "cm"],
              ] as const).map(([label, value, unit]) => (
                <div
                  key={label}
                  className="rounded-md border border-border/50 px-2 py-2"
                >
                  <p className="text-[10px] text-muted-foreground uppercase">
                    {label}
                  </p>
                  <p className="font-semibold">
                    {value !== null ? `${value}${unit ? " " + unit : ""}` : "—"}
                  </p>
                </div>
              ))}
            </div>
            {detail.recentMeasurements.length > 1 && (
              <details className="mt-3">
                <summary className="text-xs text-primary cursor-pointer">
                  Show {detail.recentMeasurements.length - 1} earlier reading
                  {detail.recentMeasurements.length === 2 ? "" : "s"}
                </summary>
                <div className="mt-2 space-y-1 text-xs">
                  {detail.recentMeasurements.slice(1).map((m) => (
                    <div
                      key={m.id}
                      className="flex flex-wrap gap-x-3 border-t border-border/30 pt-1"
                    >
                      <span className="text-muted-foreground">
                        {formatDate(m.date)}
                      </span>
                      {m.weight !== null && <span>W: {m.weight}kg</span>}
                      {m.bmi !== null && <span>BMI: {m.bmi}</span>}
                      {m.waist !== null && <span>Waist: {m.waist}cm</span>}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sessions history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <NotebookPen className="size-4" /> Sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {allSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sessions recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {allSessions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start justify-between gap-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {formatDateTime(s.scheduledAt)}
                    </p>
                    {s.notes && (
                      <p className="text-xs text-muted-foreground truncate">
                        {s.notes}
                      </p>
                    )}
                  </div>
                  <div className="flex items-start gap-2 shrink-0">
                    <Badge variant="outline" className={statusClass(s.status)}>
                      {s.status}
                    </Badge>
                    {s.status === "scheduled" &&
                      s.packageStatus === "active" && (
                        <CompleteSessionButton sessionId={s.id} />
                      )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
