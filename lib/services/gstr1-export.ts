import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";

export type Gstr1ExportParams = {
  quarter: 1 | 2 | 3 | 4; // Indian fiscal quarter
  year: number; // calendar year of quarter end
  locationId?: number;
};

export type Gstr1Row = {
  invoiceNumber: string;
  invoiceDate: string; // DD-MM-YYYY
  customerName: string;
  customerType: "B2B" | "B2C";
  customerGSTIN: string;
  hsnSacCode: string;
  rate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalInvoiceValue: number;
};

export type Gstr1Result = {
  rows: Gstr1Row[];
  csv: string;
  meta: {
    quarter: number;
    year: number;
    fromDate: string; // YYYY-MM-DD
    toDate: string; // YYYY-MM-DD
    totalTaxableValue: number;
    totalGst: number;
    isComposition: boolean;
    note?: string;
  };
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function gstinStateCode(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const trimmed = gstin.trim();
  if (trimmed.length < 2) return null;
  return trimmed.slice(0, 2);
}

function fmtDateDDMMYYYY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function fmtDateYYYYMMDD(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Map an Indian fiscal quarter and the calendar year in which it ENDS to a
 * date range.
 *   Q1 (Apr-Jun) — quarter ends in same year
 *   Q2 (Jul-Sep) — quarter ends in same year
 *   Q3 (Oct-Dec) — quarter ends in same year
 *   Q4 (Jan-Mar) — quarter ends in same year (FY started previous calendar year)
 */
function quarterToDateRange(quarter: 1 | 2 | 3 | 4, year: number): {
  from: Date;
  to: Date;
} {
  let fromMonth: number; // 0-indexed
  let toMonth: number;
  let fromYear = year;
  let toYear = year;
  switch (quarter) {
    case 1:
      fromMonth = 3; // Apr
      toMonth = 5; // Jun
      break;
    case 2:
      fromMonth = 6; // Jul
      toMonth = 8; // Sep
      break;
    case 3:
      fromMonth = 9; // Oct
      toMonth = 11; // Dec
      break;
    case 4:
      fromMonth = 0; // Jan
      toMonth = 2; // Mar
      break;
  }
  const from = new Date(fromYear, fromMonth, 1, 0, 0, 0, 0);
  const to = new Date(toYear, toMonth + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(rows: Gstr1Row[]): string {
  const headers = [
    "Invoice Number",
    "Invoice Date",
    "Customer Name",
    "Customer Type",
    "Customer GSTIN",
    "HSN/SAC",
    "Rate (%)",
    "Taxable Value",
    "CGST",
    "SGST",
    "IGST",
    "Total Invoice Value",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.invoiceNumber),
        csvEscape(r.invoiceDate),
        csvEscape(r.customerName),
        csvEscape(r.customerType),
        csvEscape(r.customerGSTIN),
        csvEscape(r.hsnSacCode),
        csvEscape(r.rate),
        csvEscape(r.taxableValue.toFixed(2)),
        csvEscape(r.cgst.toFixed(2)),
        csvEscape(r.sgst.toFixed(2)),
        csvEscape(r.igst.toFixed(2)),
        csvEscape(r.totalInvoiceValue.toFixed(2)),
      ].join(","),
    );
  }
  return lines.join("\n");
}

export async function exportGstr1(
  params: Gstr1ExportParams,
): Promise<Gstr1Result> {
  const { quarter, year, locationId } = params;
  const { from, to } = quarterToDateRange(quarter, year);

  const [scheme, hsn, gstRateStr, gymGstin] = await Promise.all([
    getSetting("gym_gst_scheme", "regular"),
    getSetting("gym_service_hsn", "999723"),
    getSetting("gym_gst_rate", "18"),
    getSetting("gym_gstin", ""),
  ]);

  const fromDate = fmtDateYYYYMMDD(from);
  const toDate = fmtDateYYYYMMDD(to);

  if (scheme === "composition") {
    return {
      rows: [],
      csv: "",
      meta: {
        quarter,
        year,
        fromDate,
        toDate,
        totalTaxableValue: 0,
        totalGst: 0,
        isComposition: true,
        note:
          "Gym is on the GST composition scheme — file CMP-08 instead of GSTR-1.",
      },
    };
  }

  const gstRate = parseFloat(gstRateStr) || 0;
  const gymStateCode = gstinStateCode(gymGstin);

  const invoices = await prisma.invoice.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      ...(locationId
        ? { payment: { locationId } }
        : {}),
    },
    include: {
      user: true,
      payment: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const rows: Gstr1Row[] = [];
  let totalTaxableValue = 0;
  let totalGst = 0;

  for (const inv of invoices) {
    const totalAmount = inv.payment ? Number(inv.payment.amount) : 0;
    if (totalAmount <= 0) continue;

    const taxableValue = round2(totalAmount / (1 + gstRate / 100));
    const gstTotal = round2(totalAmount - taxableValue);

    const customerGstin = (inv.user.gstin ?? "").trim();
    const customerType: "B2B" | "B2C" = customerGstin ? "B2B" : "B2C";
    const customerStateCode = gstinStateCode(customerGstin);

    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    const isIntraState =
      !customerGstin || !gymStateCode || customerStateCode === gymStateCode;
    if (isIntraState) {
      const half = round2(gstTotal / 2);
      cgst = half;
      sgst = round2(gstTotal - half);
    } else {
      igst = gstTotal;
    }

    const customerName =
      `${inv.user.firstname} ${inv.user.lastname}`.trim() || "Walk-in Customer";

    rows.push({
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: fmtDateDDMMYYYY(inv.createdAt),
      customerName,
      customerType,
      customerGSTIN: customerGstin,
      hsnSacCode: hsn,
      rate: gstRate,
      taxableValue,
      cgst,
      sgst,
      igst,
      totalInvoiceValue: round2(totalAmount),
    });

    totalTaxableValue += taxableValue;
    totalGst += gstTotal;
  }

  return {
    rows,
    csv: rowsToCsv(rows),
    meta: {
      quarter,
      year,
      fromDate,
      toDate,
      totalTaxableValue: round2(totalTaxableValue),
      totalGst: round2(totalGst),
      isComposition: false,
    },
  };
}
