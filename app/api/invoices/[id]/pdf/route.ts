import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { escapeHtml } from "@/lib/utils/html";

/**
 * Validate a logo URL for safe inclusion in an <img src="..."> attribute.
 * Allow only http(s) absolute URLs or relative paths starting with "/".
 * Reject javascript:, data:, and any other scheme to prevent XSS.
 */
function safeLogoUrl(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const s = typeof raw === "string" ? raw : String(raw);
  if (s.length === 0) return "";
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return "";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const invoiceId = parseInt(id, 10);

  if (isNaN(invoiceId)) {
    return Response.json({ error: "Invalid invoice ID" }, { status: 400 });
  }

  // AuthN: require a session. Anonymous access leaks PII via id enumeration.
  const session = await getServerSession(authOptions);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      user: { select: { firstname: true, lastname: true, email: true, phone: true } },
      payment: {
        select: {
          amount: true,
          paymentMode: true,
          upiReference: true,
          oldExpiryDate: true,
          newExpiryDate: true,
          createdAt: true,
          memberTicket: {
            select: {
              joiningFeeCharged: true,
              plan: { select: { name: true, expireDays: true } },
            },
          },
        },
      },
    },
  });

  if (!invoice) {
    return Response.json({ error: "Invoice not found" }, { status: 404 });
  }

  // AuthZ: members may only access their own invoices. Workers may access any.
  if (session.user.actorType === "member") {
    const sessionUserId = Number(session.user.id);
    if (!Number.isFinite(sessionUserId) || sessionUserId !== invoice.userId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const gymName = await getSetting("gym_name", process.env.NEXT_PUBLIC_GYM_NAME || "TraqGym");
  const gymLogoRaw = await getSetting("gym_logo", "");
  const gymLogo = safeLogoUrl(gymLogoRaw);
  const gymGstin = await getSetting("gym_gstin", process.env.GYM_GSTIN || "");
  const gymAddress = await getSetting("gym_address", process.env.GYM_ADDRESS || "");
  const gymState = await getSetting("gym_state", process.env.GYM_STATE || "Maharashtra");
  const gymPhone = await getSetting("gym_phone", process.env.GYM_PHONE || "");
  const gymEmail = await getSetting("gym_email", process.env.GYM_EMAIL || "");
  const isTaxInvoice = gymGstin.length > 0;

  const memberName = `${invoice.user.firstname} ${invoice.user.lastname}`;
  const planName = invoice.payment.memberTicket.plan.name;
  const durationDays = invoice.payment.memberTicket.plan.expireDays;
  const totalAmount = Number(invoice.payment.amount);
  const joiningFee = Number(invoice.payment.memberTicket.joiningFeeCharged ?? 0);
  // Plan portion = total - joining fee (joining fee not GST-applicable in this simple model)
  const planPortion = Math.max(totalAmount - joiningFee, 0);
  const baseAmount = isTaxInvoice ? Math.round((planPortion / 1.18) * 100) / 100 : planPortion;
  const cgst = isTaxInvoice ? Math.round(((planPortion - baseAmount) / 2) * 100) / 100 : 0;
  const sgst = cgst;
  const paymentMode = invoice.payment.paymentMode.toUpperCase();
  const upiRef = invoice.payment.upiReference ?? "N/A";
  const invoiceDate = new Date(invoice.createdAt).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const validFrom = new Date(
    invoice.payment.oldExpiryDate ?? invoice.payment.createdAt
  ).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
  const validTo = invoice.payment.newExpiryDate
    ? new Date(invoice.payment.newExpiryDate).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "N/A";

  const fmtCurrency = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isTaxInvoice ? "Tax Invoice" : "Invoice"} ${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #1a1a1a;
      background: #f5f5f5;
      padding: 20px;
    }
    .invoice-container {
      max-width: 700px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      overflow: hidden;
    }
    .header {
      background: #111827;
      color: #fff;
      padding: 28px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    .header .invoice-meta { text-align: right; font-size: 13px; opacity: 0.85; }
    .header .invoice-meta .inv-number { font-size: 15px; font-weight: 600; opacity: 1; }
    .header .invoice-meta .inv-type { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.7; }
    .body { padding: 28px 32px; }
    .section { margin-bottom: 24px; }
    .section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #6b7280;
      margin-bottom: 8px;
      border-bottom: 1px solid #f0f0f0;
      padding-bottom: 4px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 24px;
    }
    .info-row { display: flex; gap: 8px; font-size: 14px; line-height: 1.6; }
    .info-label { color: #6b7280; min-width: 110px; }
    .info-value { font-weight: 500; }
    .tax-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .tax-table th, .tax-table td { padding: 8px 12px; text-align: left; font-size: 14px; border-bottom: 1px solid #f0f0f0; }
    .tax-table th { color: #6b7280; font-weight: 600; font-size: 12px; text-transform: uppercase; }
    .tax-table td.right, .tax-table th.right { text-align: right; }
    .tax-table .total-row { font-weight: 700; border-top: 2px solid #e5e7eb; }
    .amount-section {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .amount-label { font-size: 14px; color: #374151; }
    .amount-value { font-size: 24px; font-weight: 700; color: #111827; }
    .paid-stamp {
      display: inline-block;
      color: #16a34a;
      border: 3px solid #16a34a;
      border-radius: 6px;
      font-size: 18px;
      font-weight: 800;
      padding: 4px 16px;
      transform: rotate(-5deg);
      letter-spacing: 3px;
    }
    .footer {
      border-top: 1px solid #e5e7eb;
      padding: 16px 32px;
      text-align: center;
      font-size: 11px;
      color: #9ca3af;
    }
    .print-btn {
      display: block;
      margin: 20px auto;
      padding: 10px 28px;
      background: #111827;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
    }
    .print-btn:hover { background: #374151; }

    @media print {
      body { background: #fff; padding: 0; }
      .invoice-container { border: none; border-radius: 0; }
      .print-btn { display: none !important; }
      .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .paid-stamp { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .amount-section { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="invoice-container">
    <div class="header">
      <div>
        ${gymLogo ? `<img src="${escapeHtml(gymLogo)}" alt="${escapeHtml(gymName)}" style="height:36px;margin-bottom:4px" />` : ""}
        <h1>${escapeHtml(gymName)}</h1>
        ${gymAddress ? `<div style="font-size:12px;opacity:0.8;margin-top:4px">${escapeHtml(gymAddress)}</div>` : ""}
        ${gymPhone || gymEmail ? `<div style="font-size:12px;opacity:0.7;margin-top:2px">${[gymPhone, gymEmail].filter(Boolean).map(escapeHtml).join(" | ")}</div>` : ""}
        ${gymGstin ? `<div style="font-size:12px;opacity:0.8;margin-top:2px">GSTIN: ${escapeHtml(gymGstin)}</div>` : ""}
      </div>
      <div class="invoice-meta">
        <div class="inv-type">${isTaxInvoice ? "Tax Invoice" : "Invoice"}</div>
        <div class="inv-number">${escapeHtml(invoice.invoiceNumber)}</div>
        <div>${invoiceDate}</div>
      </div>
    </div>

    <div class="body">
      ${isTaxInvoice ? `
      <div class="section">
        <div class="section-title">Supply Details</div>
        <div class="info-grid">
          <div class="info-row">
            <span class="info-label">Place of Supply</span>
            <span class="info-value">${escapeHtml(gymState)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">SAC Code</span>
            <span class="info-value">99722</span>
          </div>
        </div>
      </div>
      ` : ""}

      <div class="section">
        <div class="section-title">Member Details</div>
        <div class="info-grid">
          <div class="info-row">
            <span class="info-label">Name</span>
            <span class="info-value">${escapeHtml(memberName)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Email</span>
            <span class="info-value">${escapeHtml(invoice.user.email)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Phone</span>
            <span class="info-value">${escapeHtml(invoice.user.phone ?? "N/A")}</span>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Plan Details</div>
        <div class="info-grid">
          <div class="info-row">
            <span class="info-label">Plan</span>
            <span class="info-value">${escapeHtml(planName)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Duration</span>
            <span class="info-value">${durationDays} days</span>
          </div>
          <div class="info-row">
            <span class="info-label">Valid From</span>
            <span class="info-value">${validFrom}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Valid To</span>
            <span class="info-value">${validTo}</span>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Payment Details</div>
        <div class="info-grid">
          <div class="info-row">
            <span class="info-label">Mode</span>
            <span class="info-value">${escapeHtml(paymentMode)}</span>
          </div>
          ${paymentMode === "UPI" ? `<div class="info-row"><span class="info-label">UPI Ref</span><span class="info-value">${escapeHtml(upiRef)}</span></div>` : ""}
        </div>
      </div>

      ${isTaxInvoice ? `
      <div class="section">
        <div class="section-title">Tax Breakdown</div>
        <table class="tax-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>SAC</th>
              <th class="right">Amount (Rs.)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Health and fitness services - ${escapeHtml(planName)}</td>
              <td>99722</td>
              <td class="right">${fmtCurrency(baseAmount)}</td>
            </tr>
            <tr>
              <td>CGST @ 9%</td>
              <td></td>
              <td class="right">${fmtCurrency(cgst)}</td>
            </tr>
            <tr>
              <td>SGST @ 9%</td>
              <td></td>
              <td class="right">${fmtCurrency(sgst)}</td>
            </tr>
            ${joiningFee > 0 ? `<tr>
              <td>Joining Fee</td>
              <td></td>
              <td class="right">${fmtCurrency(joiningFee)}</td>
            </tr>` : ""}
            <tr class="total-row">
              <td colspan="2">Total</td>
              <td class="right">Rs. ${fmtCurrency(totalAmount)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      ` : `
      ${joiningFee > 0 ? `
      <div class="section">
        <div class="section-title">Charges</div>
        <table class="tax-table">
          <thead>
            <tr>
              <th>Description</th>
              <th class="right">Amount (Rs.)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${escapeHtml(planName)}</td>
              <td class="right">${fmtCurrency(planPortion)}</td>
            </tr>
            <tr>
              <td>Joining Fee</td>
              <td class="right">${fmtCurrency(joiningFee)}</td>
            </tr>
            <tr class="total-row">
              <td>Total</td>
              <td class="right">Rs. ${fmtCurrency(totalAmount)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      ` : ""}
      <div class="amount-section">
        <div>
          <div class="amount-label">Amount Paid</div>
          <div class="amount-value">Rs. ${fmtCurrency(totalAmount)}</div>
        </div>
        <div class="paid-stamp">PAID</div>
      </div>
      `}

      ${isTaxInvoice ? `
      <div class="amount-section">
        <div>
          <div class="amount-label">Total Amount Paid</div>
          <div class="amount-value">Rs. ${fmtCurrency(totalAmount)}</div>
        </div>
        <div class="paid-stamp">PAID</div>
      </div>
      ` : ""}
    </div>

    <div class="footer">
      This is a computer-generated ${isTaxInvoice ? "tax invoice" : "invoice"} and does not require a signature.
    </div>
  </div>

  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
