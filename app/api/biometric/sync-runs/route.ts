import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get("deviceId");

  const where = deviceId ? { deviceId: Number(deviceId) } : {};

  const runs = await prisma.biometricSyncRun.findMany({
    where,
    include: { device: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return Response.json(runs);
}
