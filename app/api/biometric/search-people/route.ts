import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || "";
  if (q.length < 2) return Response.json([]);

  const [members, workers] = await Promise.all([
    prisma.user.findMany({
      where: {
        OR: [
          { firstname: { contains: q, mode: "insensitive" } },
          { lastname: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ],
      },
      select: { id: true, firstname: true, lastname: true, phone: true },
      take: 10,
    }),
    prisma.worker.findMany({
      where: {
        OR: [
          { firstname: { contains: q, mode: "insensitive" } },
          { lastname: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, firstname: true, lastname: true },
      take: 10,
    }),
  ]);

  return Response.json({
    members: members.map((m) => ({
      id: m.id,
      label: `${m.firstname} ${m.lastname}${m.phone ? ` (${m.phone})` : ""}`,
      type: "member" as const,
    })),
    workers: workers.map((w) => ({
      id: w.id,
      label: `${w.firstname} ${w.lastname} (Staff)`,
      type: "worker" as const,
    })),
  });
}
