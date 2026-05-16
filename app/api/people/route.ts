import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const MAX_RESULTS = 500;

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (session.user as { role?: string }).role;
  const locationId = (session.user as { locationId?: number | null }).locationId ?? null;

  // Admins see everyone. Staff/trainer scoped to their location.
  const userWhere: { locationId?: number } = {};
  const workerWhere: { isActive: boolean; locationId?: number } = { isActive: true };

  if (role !== "admin") {
    if (locationId == null) {
      // Non-admin worker without a location can't see anyone (safe default).
      return Response.json([]);
    }
    userWhere.locationId = locationId;
    workerWhere.locationId = locationId;
  }

  const [users, workers] = await Promise.all([
    prisma.user.findMany({
      where: userWhere,
      select: { id: true, firstname: true, lastname: true },
      orderBy: { firstname: "asc" },
      take: MAX_RESULTS,
    }),
    prisma.worker.findMany({
      where: workerWhere,
      select: { id: true, firstname: true, lastname: true },
      orderBy: { firstname: "asc" },
      take: MAX_RESULTS,
    }),
  ]);

  return Response.json([
    ...users.map((u) => ({ id: u.id, name: `${u.firstname} ${u.lastname}`, type: "member" as const })),
    ...workers.map((w) => ({ id: w.id, name: `${w.firstname} ${w.lastname}`, type: "staff" as const })),
  ]);
}
