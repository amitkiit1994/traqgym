import { NextResponse, type NextRequest } from "next/server";
import { requireWorker } from "@/lib/auth-guard";
import { exportInvoicesAsTallyXml } from "@/lib/services/tally-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// IST = UTC+5:30, no DST. All Tally export bounds and filenames are computed
// in IST so the period matches Indian fiscal accounting on a UTC server (Vercel).

// Build a Date that represents 00:00 IST on the given calendar date.
function istDateUTC(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - 5.5 * 3600 * 1000);
}

// Return the IST calendar parts (year/month/day) for a given instant.
function istParts(d: Date): { year: number; month: number; day: number } {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    day: ist.getUTCDate(),
  };
}

function startOfMonthIst(d: Date): Date {
  const { year, month } = istParts(d);
  return istDateUTC(year, month, 1);
}

function endOfMonthIst(d: Date): Date {
  const { year, month } = istParts(d);
  // 1ms before 00:00 IST of the first day of next month.
  return new Date(istDateUTC(year, month + 1, 1).getTime() - 1);
}

function fmtYMD(d: Date): string {
  const { year, month, day } = istParts(d);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

  let from = parseDateOrNull(sp.get("from")) ?? startOfMonthIst(now);
  let to = parseDateOrNull(sp.get("to")) ?? endOfMonthIst(now);

  // Normalize to start-of-day / end-of-day in IST so the to-date is inclusive
  // for the IST calendar day the user typed (not the UTC server day).
  const fromParts = istParts(from);
  const toParts = istParts(to);
  from = istDateUTC(fromParts.year, fromParts.month, fromParts.day);
  to = new Date(istDateUTC(toParts.year, toParts.month, toParts.day + 1).getTime() - 1);

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
