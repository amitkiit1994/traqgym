import { NextResponse, type NextRequest } from "next/server";
import { requireWorker } from "@/lib/auth-guard";
import { exportInvoicesAsTallyXml } from "@/lib/services/tally-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function fmtYMD(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateOrNull(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(request: NextRequest) {
  try {
    await requireWorker(["admin"]);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const now = new Date();

  let from = parseDateOrNull(sp.get("from")) ?? startOfMonth(now);
  let to = parseDateOrNull(sp.get("to")) ?? endOfMonth(now);

  // Normalize to start-of-day / end-of-day so the to-date is inclusive
  from = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0);
  to = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);

  if (to < from) {
    return NextResponse.json(
      { error: "to date must be on or after from date" },
      { status: 400 },
    );
  }

  const locationIdRaw = sp.get("locationId");
  const locationId = locationIdRaw ? parseInt(locationIdRaw, 10) : undefined;
  if (locationIdRaw && (locationId === undefined || isNaN(locationId))) {
    return NextResponse.json({ error: "Invalid locationId" }, { status: 400 });
  }

  const xml = await exportInvoicesAsTallyXml({ from, to, locationId });

  const filename = `tally-vouchers-${fmtYMD(from)}-to-${fmtYMD(to)}.xml`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
