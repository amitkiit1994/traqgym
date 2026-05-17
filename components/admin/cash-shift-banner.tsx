import Link from "next/link";
import { prisma } from "@/lib/prisma";

/**
 * Surfaces a one-line warning when:
 *   - no cash shift is currently open for the location, AND
 *   - cash payments have already been collected today
 *
 * Drives Robin's staff to open a shift so end-of-day reconciliation can run.
 * Renders nothing in the safe case so the dashboard stays uncluttered.
 */
export async function CashShiftBanner({ locationId }: { locationId?: number }) {
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const [openShift, todayCashCount] = await Promise.all([
    prisma.cashShift.findFirst({
      where: { status: "open", ...(locationId ? { locationId } : {}) },
      select: { id: true },
    }),
    prisma.payment.count({
      where: {
        paymentMode: { in: ["cash", "Cash", "CASH"] },
        createdAt: { gte: dayStart },
        ...(locationId ? { locationId } : {}),
      },
    }),
  ]);

  if (openShift || todayCashCount === 0) return null;

  return (
    <div className="px-4 pt-4 md:px-6">
      <div className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200 md:flex-row md:items-center md:justify-between">
        <div>
          <strong>No open cash shift.</strong> {todayCashCount} cash payment{todayCashCount === 1 ? "" : "s"} have
          been collected today — they will not be bound to a shift unless one is open. End-of-day reconciliation
          will be incomplete.
        </div>
        <Link
          href="/admin/shifts"
          className="inline-flex items-center justify-center rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
        >
          Open shift
        </Link>
      </div>
    </div>
  );
}
