import { notFound } from "next/navigation";
import { requireWorker } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { getTrainerStats, getMyPtClients } from "@/lib/services/pt";
import { listPayoutsForTrainer } from "@/lib/services/trainer-payout";
import { TrainerDetailClient } from "./trainer-detail-client";

function currentMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export default async function TrainerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireWorker(["admin"]);

  const { id } = await params;
  const trainerId = parseInt(id, 10);
  if (!Number.isFinite(trainerId)) notFound();

  const trainer = await prisma.worker.findUnique({
    where: { id: trainerId },
    select: {
      id: true,
      firstname: true,
      lastname: true,
      role: true,
      email: true,
      isActive: true,
      isExternal: true,
      defaultGymCutPct: true,
      ownTrainerCutPct: true,
    },
  });
  if (!trainer) notFound();

  const range = currentMonthRange();

  const [stats, clients, payouts, recentSessions] = await Promise.all([
    getTrainerStats(trainerId, { from: range.start, to: range.end }),
    getMyPtClients(trainerId),
    listPayoutsForTrainer(trainerId),
    prisma.ptSession.findMany({
      where: { package: { trainerId } },
      orderBy: { scheduledAt: "desc" },
      take: 25,
      include: {
        package: {
          select: {
            id: true,
            user: { select: { firstname: true, lastname: true } },
            pricePerSession: true,
          },
        },
      },
    }),
  ]);

  const serializedTrainer = {
    id: trainer.id,
    firstname: trainer.firstname,
    lastname: trainer.lastname,
    email: trainer.email,
    role: trainer.role,
    isActive: trainer.isActive,
    isExternal: trainer.isExternal,
    defaultGymCutPct: Number(trainer.defaultGymCutPct),
    ownTrainerCutPct: Number(trainer.ownTrainerCutPct),
  };

  const serializedSessions = recentSessions.map((s) => ({
    id: s.id,
    packageId: s.packageId,
    memberName: `${s.package.user.firstname} ${s.package.user.lastname}`,
    scheduledAt: s.scheduledAt.toISOString(),
    completedAt: s.completedAt?.toISOString() ?? null,
    status: s.status,
    notes: s.notes,
    pricePerSession: Number(s.package.pricePerSession),
  }));

  return (
    <TrainerDetailClient
      trainer={serializedTrainer}
      stats={stats}
      clients={clients}
      payouts={payouts}
      recentSessions={serializedSessions}
      currentPeriod={{
        month: range.start.getUTCMonth() + 1,
        year: range.start.getUTCFullYear(),
      }}
    />
  );
}
