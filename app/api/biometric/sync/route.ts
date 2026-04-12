import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { syncFromBiomax } from "@/lib/services/biometric";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { deviceId } = body;

  if (!deviceId) {
    return Response.json({ error: "deviceId required" }, { status: 400 });
  }

  try {
    const result = await syncFromBiomax(Number(deviceId));
    return Response.json(result);
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
