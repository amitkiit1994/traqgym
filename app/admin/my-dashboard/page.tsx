"use client";

import { useEffect, useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { getMyDashboard } from "@/lib/actions/worker-dashboard";
import { workerCheckIn, workerCheckOut } from "@/lib/actions/worker-attendance";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DashboardData = {
  attendance: {
    id: number;
    checkIn: string;
    checkOut: string | null;
  } | null;
  collectionsToday: { total: number; count: number };
  collectionsMonth: { total: number; count: number };
  recentCollections: {
    id: number;
    memberName: string;
    planName: string;
    amount: number;
    paymentMode: string;
    date: string;
  }[];
  leaveBalance: {
    pending: number;
    approved: number;
    rejected: number;
    total: number;
  };
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function MyDashboardPage() {
  const { data: session } = useSession();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const currentUser = session?.user as any;
  const workerId = currentUser?.id ? parseInt(currentUser.id, 10) : 0;
  const locationId = currentUser?.locationId ?? undefined;

  const loadDashboard = () => {
    if (!workerId) return;
    startTransition(async () => {
      const data = await getMyDashboard(workerId, locationId);
      if ("error" in data) return;
      setDashboard(data);
    });
  };

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerId]);

  const handleCheckIn = () => {
    if (!workerId || !locationId) return;
    startTransition(async () => {
      const res = await workerCheckIn(workerId, locationId);
      if (res.success) {
        setMessage(
          "existing" in res && res.existing
            ? "Already checked in today"
            : "Checked in"
        );
        loadDashboard();
      } else {
        setMessage("error" in res ? res.error ?? "Error" : "Error");
      }
    });
  };

  const handleCheckOut = () => {
    if (!dashboard?.attendance) return;
    startTransition(async () => {
      const res = await workerCheckOut(dashboard.attendance!.id);
      if (res.success) {
        setMessage("Checked out");
        loadDashboard();
      } else {
        setMessage("error" in res ? res.error ?? "Error" : "Error");
      }
    });
  };

  if (!dashboard) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">My Dashboard</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">My Dashboard</h1>

      {message && (
        <p className="text-sm text-muted-foreground">{message}</p>
      )}

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {/* My Attendance Today */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              My Attendance Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.attendance ? (
              <div className="space-y-1">
                <p className="text-sm">
                  Checked in at{" "}
                  <span className="font-semibold">
                    {formatTime(dashboard.attendance.checkIn)}
                  </span>
                </p>
                {dashboard.attendance.checkOut ? (
                  <p className="text-sm">
                    Checked out at{" "}
                    <span className="font-semibold">
                      {formatTime(dashboard.attendance.checkOut)}
                    </span>
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Not checked out yet
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCheckOut}
                      disabled={isPending}
                    >
                      Check Out
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Not checked in</p>
                <Button
                  size="sm"
                  onClick={handleCheckIn}
                  disabled={isPending}
                >
                  Check In
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* My Collections Today */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              My Collections Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatCurrency(dashboard.collectionsToday.total)}
            </p>
            <p className="text-sm text-muted-foreground">
              {dashboard.collectionsToday.count} renewal(s)
            </p>
          </CardContent>
        </Card>

        {/* My Collections This Month */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              My Collections This Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatCurrency(dashboard.collectionsMonth.total)}
            </p>
            <p className="text-sm text-muted-foreground">
              {dashboard.collectionsMonth.count} renewal(s)
            </p>
          </CardContent>
        </Card>

        {/* My Leave Balance */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              My Leave Balance (This Year)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="secondary">
                Pending: {dashboard.leaveBalance.pending}
              </Badge>
              <Badge variant="default">
                Approved: {dashboard.leaveBalance.approved}
              </Badge>
              <Badge variant="destructive">
                Rejected: {dashboard.leaveBalance.rejected}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Collections */}
      <Card>
        <CardHeader>
          <CardTitle>My Recent Collections</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="hidden sm:table-cell">Plan</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="hidden md:table-cell">Mode</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.recentCollections.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.memberName}</TableCell>
                  <TableCell className="hidden sm:table-cell">{c.planName}</TableCell>
                  <TableCell>{formatCurrency(c.amount)}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant="secondary">{c.paymentMode}</Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{formatDate(c.date)}</TableCell>
                </TableRow>
              ))}
              {dashboard.recentCollections.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    No collections yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
