import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeMonthlyPayout } from "@/lib/services/trainer-payout";
import { requireCronSecret } from "@/lib/auth-cron";
import { istCalendarFor } from "@/lib/utils/date-ist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  // Compute payout for the prior IST month. The cron fires at 00:00 IST on the
  // 1st of each month, which on the UTC server is 18:30 UTC on the LAST day of
  // the prior month. Using getUTCMonth() here would yield the wrong calendar
  // month, so anchor to the IST calendar before subtracting 1.
  const now = new Date();
  const ist = istCalendarFor(now); // month is 0-11
  let month = ist.month - 1; // 0-11; subtract 1 for prior month
  let year = ist.year;
  if (month < 0) {
    month = 11;
    year -= 1;
  }
  // Convert 0-11 -> 1-12 for service contract
  const monthOneIndexed = month + 1;

  // Find all trainers (workers) who have at least one PtPackage. We don't filter by role, since gyms
  // sometimes give "staff" trainers PT clients too.
  const trainers = await prisma.worker.findMany({
    where: {
      isActive: true,
      ptPackagesAsTrainer: { some: {} },
    },
    select: { id: true },
  });

  let payoutsCreated = 0;
  let failed = 0;
  const errors: Array<{ trainerId: number; error: string }> = [];

  for (const t of trainers) {
    const result = await computeMonthlyPayout(t.id, monthOneIndexed, year);
    if (result.success) {
      payoutsCreated++;
    } else {
      failed++;
      errors.push({ trainerId: t.id, error: result.error });
    }
  }

  return Response.json({
    ok: true,
    period: { month: monthOneIndexed, year },
    trainersConsidered: trainers.length,
    payoutsCreated,
    failed,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
