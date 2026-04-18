import { runMultiLocationComparator } from "@/lib/agents/multi-location-comparator";

export async function GET(request: Request) {
  const secret =
    request.headers.get("x-cron-secret") ||
    new URL(request.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
