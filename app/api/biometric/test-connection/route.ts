import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSetting } from "@/lib/services/settings";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = (await getSetting("biomax_sdk_base_url", "")) || process.env.BIOMAX_SDK_BASE_URL;
  const apiKey = (await getSetting("biomax_sdk_api_key", "")) || process.env.BIOMAX_SDK_API_KEY;

  if (!baseUrl) {
    return Response.json({ connected: false, error: "BioMax SDK URL not configured" });
  }

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["X-API-Key"] = apiKey;

    const response = await fetch(`${baseUrl}/api/status`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return Response.json({ connected: true, status: response.status });
    } else {
      return Response.json({ connected: false, error: `HTTP ${response.status}` });
    }
  } catch (err: any) {
    return Response.json({ connected: false, error: err.message || "Connection failed" });
  }
}
