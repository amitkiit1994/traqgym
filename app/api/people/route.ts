import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    select: { id: true, firstname: true, lastname: true },
    orderBy: { firstname: "asc" },
  });

  const workers = await prisma.worker.findMany({
    where: { isActive: true },
    select: { id: true, firstname: true, lastname: true },
    orderBy: { firstname: "asc" },
  });

  const people = [
    ...users.map((u) => ({
      id: u.id,
      name: `${u.firstname} ${u.lastname}`,
      type: "member" as const,
    })),
    ...workers.map((w) => ({
      id: w.id,
      name: `${w.firstname} ${w.lastname}`,
      type: "staff" as const,
    })),
  ];

  return Response.json(people);
}
