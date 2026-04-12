import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { importCSV } from "@/lib/services/biometric";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { deviceId, csvContent } = body;

  if (!deviceId || !csvContent) {
    return Response.json(
      { error: "deviceId and csvContent required" },
      { status: 400 }
    );
  }

  try {
    const result = await importCSV(Number(deviceId), csvContent);
    return Response.json(result);
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
