import { NextRequest } from "next/server";
import { runMultiLocationComparator } from "@/lib/agents/multi-location-comparator";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  try {
    const result = await runMultiLocationComparator();
    return Response.json({ success: true, ...result });
  } catch (err) {
    return Response.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
