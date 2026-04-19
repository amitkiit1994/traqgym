import { NextResponse } from "next/server";
import { getSetting } from "@/lib/services/settings";

// Sprint 3 perf: gym brand is fetched on every page load by the client layout.
// Settings rarely change (logo + name swap is a months-long event). Fetch in
// parallel and serve with a public cache so Vercel's edge cache shields the
// origin. Stale-while-revalidate keeps it instant while refreshing in bg.
export async function GET() {
  const [name, logo] = await Promise.all([
    getSetting("gym_name", process.env.NEXT_PUBLIC_GYM_NAME || "TraqGym"),
    getSetting("gym_logo", ""),
  ]);
  return NextResponse.json(
    { name, logo },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
      },
    },
  );
}
