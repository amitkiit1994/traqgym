import { create } from "xmlbuilder2";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";

export type TallyExportParams = {
  from: Date;
  to: Date;
  locationId?: number;
};

// Format an instant as the IST calendar date Tally expects (YYYYMMDD). Without
// this shift, an invoice timestamped 2026-04-01 02:00 IST (= 2026-03-31 20:30
// UTC) would be exported as 20260331 on a UTC server (Vercel) — wrong fiscal
// month for Indian books.
function formatTallyDate(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function gstinStateCode(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const trimmed = gstin.trim();
  if (trimmed.length < 2) return null;
  return trimmed.slice(0, 2);
}

/**
 * Export invoices in the given date range as a Tally Prime importable
 * voucher XML string. Tally sign convention:
 *   - Sales (income / credit) ledger amount is rendered as a negative value
 *   - GST (CGST/SGST/IGST output) ledger amounts are rendered as positive
 * Intra-state vs inter-state is inferred from the first two characters of
 * the gym GSTIN vs the customer GSTIN. If the customer has no GSTIN, the
 * sale is treated as intra-state by default.
 */
export async function exportInvoicesAsTallyXml(
  params: TallyExportParams,
): Promise<string> {
  const { from, to, locationId } = params;

  const [salesLedger, cgstLedger, sgstLedger, igstLedger, gstRateStr, gymGstin] =
    await Promise.all([
      getSetting("tally_sales_ledger", "Sales"),
      getSetting("tally_cgst_ledger", "CGST Output"),
      getSetting("tally_sgst_ledger", "SGST Output"),
      getSetting("tally_igst_ledger", "IGST Output"),
      getSetting("gym_gst_rate", "18"),
      getSetting("gym_gstin", ""),
    ]);

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
      payment: {
        include: {
          memberTicket: { include: { plan: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const root = create({ version: "1.0", encoding: "utf-8" });
  const envelope = root.ele("ENVELOPE");
  envelope.ele("HEADER").ele("TALLYREQUEST").txt("Import Data");
  const body = envelope.ele("BODY");
  const importData = body.ele("IMPORTDATA");
  importData
    .ele("REQUESTDESC")
    .ele("REPORTNAME")
    .txt("Vouchers");
  const requestData = importData.ele("REQUESTDATA");

  for (const inv of invoices) {
    const totalAmount = inv.payment ? Number(inv.payment.amount) : 0;
    if (totalAmount <= 0) continue;

    // Back-calculate taxable value assuming inv totals are GST-inclusive.
    const taxableValue = round2(totalAmount / (1 + gstRate / 100));
    const gstTotal = round2(totalAmount - taxableValue);

    const customerGstin = (inv.user.gstin ?? "").trim() || null;
    const customerStateCode = gstinStateCode(customerGstin);
    const isIntraState = !customerGstin
      || !gymStateCode
      || customerStateCode === gymStateCode;

    const partyName = `${inv.user.firstname} ${inv.user.lastname}`.trim();
    const date = formatTallyDate(inv.createdAt);

    const tallyMessage = requestData.ele("TALLYMESSAGE", {
      "xmlns:UDF": "TallyUDF",
    });
    const voucher = tallyMessage.ele("VOUCHER", {
      VCHTYPE: "Sales",
      ACTION: "Create",
    });
    voucher.ele("DATE").txt(date);
    voucher.ele("VOUCHERTYPENAME").txt("Sales");
    voucher.ele("VOUCHERNUMBER").txt(inv.invoiceNumber);
    voucher.ele("PARTYLEDGERNAME").txt(partyName || "Walk-in Customer");
    voucher.ele("NARRATION").txt(
      inv.payment?.memberTicket?.plan?.name
        ? `Membership: ${inv.payment.memberTicket.plan.name}`
        : "Membership sale",
    );

    // Sales (income) — negative under Tally sign convention
    const salesEntry = voucher.ele("ALLLEDGERENTRIES.LIST");
    salesEntry.ele("LEDGERNAME").txt(salesLedger);
    salesEntry.ele("ISDEEMEDPOSITIVE").txt("No");
    salesEntry.ele("AMOUNT").txt(String(-taxableValue));

    if (isIntraState) {
      // R13: split GST into CGST/SGST without losing the residual paise.
      // round2(gstTotal/2) on both legs drops 0.005 when gstTotal has odd
      // paise (e.g. 13.05 → 6.52 + 6.52 = 13.04). Compute CGST first via
      // round2, then assign the remainder to SGST so the two legs always
      // sum back to gstTotal exactly.
      const cgst = round2(gstTotal / 2);
      const sgst = round2(gstTotal - cgst);
      const cgstEntry = voucher.ele("ALLLEDGERENTRIES.LIST");
      cgstEntry.ele("LEDGERNAME").txt(cgstLedger);
      cgstEntry.ele("ISDEEMEDPOSITIVE").txt("No");
      cgstEntry.ele("AMOUNT").txt(`+${cgst}`);

      const sgstEntry = voucher.ele("ALLLEDGERENTRIES.LIST");
      sgstEntry.ele("LEDGERNAME").txt(sgstLedger);
      sgstEntry.ele("ISDEEMEDPOSITIVE").txt("No");
      sgstEntry.ele("AMOUNT").txt(`+${sgst}`);
    } else {
      const igstEntry = voucher.ele("ALLLEDGERENTRIES.LIST");
      igstEntry.ele("LEDGERNAME").txt(igstLedger);
      igstEntry.ele("ISDEEMEDPOSITIVE").txt("No");
      igstEntry.ele("AMOUNT").txt(`+${gstTotal}`);
    }

    // Party debit entry (positive — money owed by party)
    const partyEntry = voucher.ele("ALLLEDGERENTRIES.LIST");
    partyEntry.ele("LEDGERNAME").txt(partyName || "Walk-in Customer");
    partyEntry.ele("ISDEEMEDPOSITIVE").txt("Yes");
    partyEntry.ele("AMOUNT").txt(`+${totalAmount}`);
  }

  // PR 13 audit fix (CRITICAL): Tally export previously emitted Sales
  // vouchers only — refunds processed in the period silently disappeared
  // from the books, leaving Tally over-stating revenue and GST liability.
  // Emit a Credit Note voucher per processed Refund. Sign convention for
  // Credit Note is the OPPOSITE of Sales:
  //   - Sales ledger entry: positive (reverses income)
  //   - GST output ledgers: negative (reverses output liability)
  //   - Party ledger:       negative (we owe the party)
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
          user: true,
          invoice: { include: { user: true } },
          memberTicket: { include: { plan: true } },
        },
      },
    },
    orderBy: { processedAt: "asc" },
  });

  for (const refund of refundsInPeriod) {
    const refundedAmount = Number(refund.amountRefunded ?? 0);
    if (refundedAmount <= 0) continue;

    const origInvoice = refund.invoice ?? refund.payment.invoice;
    const customerUser = origInvoice?.user ?? refund.payment.user;
    if (!customerUser) continue;

    const taxableValue = round2(refundedAmount / (1 + gstRate / 100));
    const gstTotal = round2(refundedAmount - taxableValue);

    const customerGstin = (customerUser.gstin ?? "").trim() || null;
    const customerStateCode = gstinStateCode(customerGstin);
    const isIntraState =
      !customerGstin || !gymStateCode || customerStateCode === gymStateCode;

    const partyName = `${customerUser.firstname} ${customerUser.lastname}`.trim();
    const date = formatTallyDate(refund.processedAt ?? refund.createdAt);
    const cnNumber = `CN-${refund.id}`;

    const tallyMessage = requestData.ele("TALLYMESSAGE", {
      "xmlns:UDF": "TallyUDF",
    });
    const voucher = tallyMessage.ele("VOUCHER", {
      VCHTYPE: "Credit Note",
      ACTION: "Create",
    });
    voucher.ele("DATE").txt(date);
    voucher.ele("VOUCHERTYPENAME").txt("Credit Note");
    voucher.ele("VOUCHERNUMBER").txt(cnNumber);
    voucher.ele("PARTYLEDGERNAME").txt(partyName || "Walk-in Customer");
    voucher.ele("NARRATION").txt(
      origInvoice
        ? `Refund of ${origInvoice.invoiceNumber} (reason: ${refund.reason})`
        : `Refund (reason: ${refund.reason})`,
    );
    if (origInvoice) {
      voucher.ele("REFERENCE").txt(origInvoice.invoiceNumber);
    }

    // Sales (income reversal) — positive in Credit Note
    const salesEntry = voucher.ele("ALLLEDGERENTRIES.LIST");
    salesEntry.ele("LEDGERNAME").txt(salesLedger);
    salesEntry.ele("ISDEEMEDPOSITIVE").txt("Yes");
    salesEntry.ele("AMOUNT").txt(`+${taxableValue}`);

    if (isIntraState) {
      const cgst = round2(gstTotal / 2);
      const sgst = round2(gstTotal - cgst);
      const cgstEntry = voucher.ele("ALLLEDGERENTRIES.LIST");
      cgstEntry.ele("LEDGERNAME").txt(cgstLedger);
      cgstEntry.ele("ISDEEMEDPOSITIVE").txt("Yes");
      cgstEntry.ele("AMOUNT").txt(`+${cgst}`);

      const sgstEntry = voucher.ele("ALLLEDGERENTRIES.LIST");
      sgstEntry.ele("LEDGERNAME").txt(sgstLedger);
      sgstEntry.ele("ISDEEMEDPOSITIVE").txt("Yes");
      sgstEntry.ele("AMOUNT").txt(`+${sgst}`);
    } else {
      const igstEntry = voucher.ele("ALLLEDGERENTRIES.LIST");
      igstEntry.ele("LEDGERNAME").txt(igstLedger);
      igstEntry.ele("ISDEEMEDPOSITIVE").txt("Yes");
      igstEntry.ele("AMOUNT").txt(`+${gstTotal}`);
    }

    // Party credit (we owe them) — negative
    const partyEntry = voucher.ele("ALLLEDGERENTRIES.LIST");
    partyEntry.ele("LEDGERNAME").txt(partyName || "Walk-in Customer");
    partyEntry.ele("ISDEEMEDPOSITIVE").txt("No");
    partyEntry.ele("AMOUNT").txt(String(-refundedAmount));
  }

  return root.end({ prettyPrint: true });
}
