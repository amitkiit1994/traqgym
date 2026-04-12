import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveMapping } from "@/lib/services/biometric";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { eventId, userId, workerId } = body;

  if (!eventId) {
    return Response.json({ error: "eventId required" }, { status: 400 });
  }

  try {
    const result = await resolveMapping(Number(eventId), {
      userId: userId ? Number(userId) : undefined,
      workerId: workerId ? Number(workerId) : undefined,
    });
    return Response.json(result);
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
