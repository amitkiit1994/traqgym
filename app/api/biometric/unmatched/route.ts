import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUnmatched } from "@/lib/services/biometric";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await getUnmatched();
  return Response.json(events);
}
