import { NextResponse, type NextRequest } from "next/server";
import { requireWorker } from "@/lib/auth-guard";
import { exportGstr1 } from "@/lib/services/gstr1-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireWorker(["admin"]);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const now = new Date();

  const quarterRaw = sp.get("quarter");
  const yearRaw = sp.get("year");

  const quarter = quarterRaw ? parseInt(quarterRaw, 10) : NaN;
  const year = yearRaw ? parseInt(yearRaw, 10) : now.getFullYear();

  if (![1, 2, 3, 4].includes(quarter)) {
    return NextResponse.json(
      { error: "quarter must be 1, 2, 3 or 4" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }

  const locationIdRaw = sp.get("locationId");
  const locationId = locationIdRaw ? parseInt(locationIdRaw, 10) : undefined;
  if (locationIdRaw && (locationId === undefined || isNaN(locationId))) {
    return NextResponse.json({ error: "Invalid locationId" }, { status: 400 });
  }

  const result = await exportGstr1({
    quarter: quarter as 1 | 2 | 3 | 4,
    year,
    locationId,
  });

  if (result.meta.isComposition) {
    return NextResponse.json(
      {
        error:
          "GSTR-1 not applicable for composition scheme. File CMP-08 instead.",
      },
      { status: 400 },
    );
  }

  const filename = `gstr1-Q${quarter}-${year}.csv`;
  return new Response(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
