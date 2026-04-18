import { requireWorker } from "@/lib/auth-guard";
import { listPtPackages } from "@/lib/services/pt";
import { prisma } from "@/lib/prisma";
import { PtPageClient } from "./pt-page-client";

export default async function PtPage() {
  await requireWorker(["admin"]);

  const [packages, trainers] = await Promise.all([
    listPtPackages({ status: "active" }),
    prisma.worker.findMany({
      where: { isActive: true },
      select: {
        id: true,
        firstname: true,
        lastname: true,
        role: true,
        isExternal: true,
        defaultGymCutPct: true,
        ownTrainerCutPct: true,
      },
      orderBy: { firstname: "asc" },
    }),
  ]);

  const serializedTrainers = trainers.map((t) => ({
    id: t.id,
    firstname: t.firstname,
    lastname: t.lastname,
    role: t.role,
    isExternal: t.isExternal,
    defaultGymCutPct: Number(t.defaultGymCutPct),
    ownTrainerCutPct: Number(t.ownTrainerCutPct),
  }));

  return (
    <PtPageClient initialPackages={packages} trainers={serializedTrainers} />
  );
}
