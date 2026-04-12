import { PrismaClient } from "@prisma/client";
import { todayIST } from "@/lib/utils/date";

type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Generate the next invoice number in format INV-YYYY-NNNN.
 * Must be called inside a Prisma transaction to avoid race conditions.
 */
async function getNextInvoiceNumber(tx: TxClient): Promise<string> {
  const year = todayIST().getFullYear();
  const prefix = `INV-${year}-`;

  const latest = await tx.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
  });

  let seq = 1;
  if (latest) {
    const parts = latest.invoiceNumber.split("-");
    seq = parseInt(parts[2], 10) + 1;
  }

  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export async function generateInvoice(
  tx: TxClient,
  params: {
    userId: number;
    paymentId: number;
  }
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const invoiceNumber = await getNextInvoiceNumber(tx);

      const invoice = await tx.invoice.create({
        data: {
          userId: params.userId,
          paymentId: params.paymentId,
          invoiceNumber,
          route: "",
          status: "paid",
        },
      });

      await tx.invoice.update({
        where: { id: invoice.id },
        data: { route: `/api/invoices/${invoice.id}/pdf` },
      });

      return { ...invoice, route: `/api/invoices/${invoice.id}/pdf` };
    } catch (err: any) {
      if (err.code === "P2002" && attempt < 2) continue;
      throw err;
    }
  }
  throw new Error("Failed to generate unique invoice number");
}
