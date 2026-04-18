import { prisma } from "@/lib/prisma";
import { computeMonthlyPayout } from "@/lib/services/trainer-payout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret =
    request.headers.get("x-cron-secret") ||
    new URL(request.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Compute payout for the prior month (UTC). For a 1st-of-month cron run,
  // this targets the month that just ended.
  const now = new Date();
  let month = now.getUTCMonth() - 1; // 0-11; subtract 1 for prior month
  let year = now.getUTCFullYear();
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
