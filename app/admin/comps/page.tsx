import Link from "next/link";
import { requireWorker } from "@/lib/auth-guard";
import {
  getActiveComps,
  getActiveCompPasses,
  getCompStats,
} from "@/lib/services/comp";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CompsPageActions,
  RevokeCompButton,
  RevokeCompPassButton,
} from "@/components/admin/comps-page-actions";

export const dynamic = "force-dynamic";

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtCurrency(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default async function CompsPage() {
  await requireWorker(["admin"]);

  const [comps, passes, stats] = await Promise.all([
    getActiveComps(),
    getActiveCompPasses(),
    getCompStats(),
  ]);

  const compRatioPct = (stats.compRatio * 100).toFixed(1);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">
            Complimentary Memberships
          </h1>
          <p className="text-sm text-muted-foreground">
            <strong>Free Plan</strong> = real plan (e.g. 1-Month Gold) issued at ₹0; counts as an active member.{" "}
            <strong>Day Pass</strong> = informal access for N days, no plan attached.
          </p>
        </div>
        <CompsPageActions />
      </header>

      <section
        aria-label="Comp stats"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3"
      >
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              Active comps
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{stats.activeCompCount}</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              Active comp passes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{stats.activeCompPassCount}</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              Comp ratio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{compRatioPct}%</p>
            <p className="text-xs text-muted-foreground">of active members</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              Est. revenue leak
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {fmtCurrency(stats.revenueLeakEstimateInRupees)}
            </p>
            <p className="text-xs text-muted-foreground">
              if all active comps were paid
            </p>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Active comps" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Active Comps</h2>
          <span className="text-xs text-muted-foreground">
            {comps.length} total
          </span>
        </div>
        {comps.length === 0 ? (
          <Card size="sm">
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No active comps.
            </CardContent>
          </Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Issued by</TableHead>
                <TableHead>Approved by</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Issued on</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Visits</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comps.map((c) => (
                <TableRow key={c.ticketId}>
                  <TableCell>
                    <Link
                      href={`/admin/members/${c.userId}`}
                      className="hover:underline underline-offset-4"
                    >
                      {c.userName}
                    </Link>
                    {c.userPhone && (
                      <div className="text-xs text-muted-foreground">
                        {c.userPhone}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {c.issuedByName ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {c.approvedByName ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">{c.planName}</TableCell>
                  <TableCell className="text-sm">
                    {c.reason ? (
                      <Badge variant="info">{c.reason}</Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {fmtDate(c.buyDate)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {fmtDate(c.expireDate)}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {c.visitsSinceIssue}
                  </TableCell>
                  <TableCell className="text-right">
                    <RevokeCompButton
                      ticketId={c.ticketId}
                      memberName={c.userName}
                      daysRemaining={
                        c.expireDate
                          ? Math.max(
                              0,
                              Math.ceil(
                                (new Date(c.expireDate).getTime() -
                                  Date.now()) /
                                  86400000,
                              ),
                            )
                          : null
                      }
                      reason={c.reason ?? null}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section aria-label="Active comp passes" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Active Comp Passes</h2>
          <span className="text-xs text-muted-foreground">
            {passes.length} total
          </span>
        </div>
        {passes.length === 0 ? (
          <Card size="sm">
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No active comp passes.
            </CardContent>
          </Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Issued by</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Visits</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {passes.map((p) => (
                <TableRow key={p.passId}>
                  <TableCell>
                    <Link
                      href={`/admin/members/${p.userId}`}
                      className="hover:underline underline-offset-4"
                    >
                      {p.userName}
                    </Link>
                    {p.userPhone && (
                      <div className="text-xs text-muted-foreground">
                        {p.userPhone}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Badge variant="info">{p.reason}</Badge>
                    {p.reasonDetail && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {p.reasonDetail}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{p.issuedByName}</TableCell>
                  <TableCell className="text-sm">
                    {fmtDate(p.startsAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {fmtDate(p.expiresAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="active">active</Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {p.visitsSinceIssue}
                  </TableCell>
                  <TableCell className="text-right">
                    <RevokeCompPassButton passId={p.passId} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
