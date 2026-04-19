import Link from "next/link";
import { requireTrainer } from "@/lib/auth-guard";
import { getMyClients } from "@/lib/services/trainer-self";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, ChevronRight } from "lucide-react";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function TrainerClientsPage() {
  const trainer = await requireTrainer();
  const clients = await getMyClients(trainer.workerId);

  return (
    <div className="space-y-4 p-3 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">My Clients</h1>
        <p className="text-sm text-muted-foreground">
          {clients.length} active PT package{clients.length === 1 ? "" : "s"}
        </p>
      </div>

      {clients.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-center">
            <Users className="size-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              You don&apos;t have any active clients yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="hidden md:block">
            <CardTitle className="text-base">Active Clients</CardTitle>
          </CardHeader>
          <CardContent className="p-0 md:p-4">
            <ul className="divide-y divide-border/50">
              {clients.map((c) => {
                const remaining = c.sessionsRemaining;
                const lowSessions = remaining <= 2;
                return (
                  <li key={c.packageId}>
                    <Link
                      href={`/trainer/clients/${c.userId}`}
                      className="flex items-center justify-between gap-3 px-3 md:px-4 py-3 hover:bg-muted/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{c.userName}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {c.userPhone ?? "No phone"} · last session{" "}
                          {formatDate(c.lastSessionAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant="outline"
                          className={
                            lowSessions
                              ? "bg-status-expiring-bg text-status-expiring-foreground border-status-expiring/30"
                              : "bg-status-info-bg text-status-info-foreground border-status-info/30"
                          }
                        >
                          {remaining}/{c.sessionsTotal} left
                        </Badge>
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
