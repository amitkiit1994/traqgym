import { create } from "xmlbuilder2";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";

export type TallyExportParams = {
  from: Date;
  to: Date;
  locationId?: number;
};

function formatTallyDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
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
      const half = round2(gstTotal / 2);
      const cgstEntry = voucher.ele("ALLLEDGERENTRIES.LIST");
      cgstEntry.ele("LEDGERNAME").txt(cgstLedger);
      cgstEntry.ele("ISDEEMEDPOSITIVE").txt("No");
      cgstEntry.ele("AMOUNT").txt(`+${half}`);

      const sgstEntry = voucher.ele("ALLLEDGERENTRIES.LIST");
      sgstEntry.ele("LEDGERNAME").txt(sgstLedger);
      sgstEntry.ele("ISDEEMEDPOSITIVE").txt("No");
      sgstEntry.ele("AMOUNT").txt(`+${half}`);
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

  return root.end({ prettyPrint: true });
}
