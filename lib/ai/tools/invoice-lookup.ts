import { tool } from "@openai/agents";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const invoiceLookupTools = [
  tool({
    name: "get_invoice",
    description:
      "Get invoice details by invoice ID, including payment info and member name",
    parameters: z.object({
      invoiceId: z.number().describe("Invoice ID"),
    }),
    async execute(input) {
      const invoice = await prisma.invoice.findUnique({
        where: { id: input.invoiceId },
        include: {
          user: { select: { id: true, firstname: true, lastname: true, phone: true } },
          payment: {
            select: {
              amount: true,
              paymentMode: true,
              upiReference: true,
              createdAt: true,
            },
          },
        },
      });
      if (!invoice) return JSON.stringify({ error: "Invoice not found" });
      return JSON.stringify({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        member: `${invoice.user.firstname} ${invoice.user.lastname}`,
        memberId: invoice.user.id,
        phone: invoice.user.phone,
        amount: Number(invoice.payment.amount),
        paymentMode: invoice.payment.paymentMode,
        upiReference: invoice.payment.upiReference,
        date: invoice.createdAt.toISOString(),
      });
    },
  }),

  tool({
    name: "search_invoices",
    description:
      "Search invoices by invoice number or member ID. Returns up to 20 results.",
    parameters: z.object({
      query: z
        .string()
        .nullable()
        .describe("Invoice number to search (partial match)"),
      userId: z
        .number()
        .nullable()
        .describe("Filter by member user ID"),
    }),
    async execute(input) {
      const where: Record<string, unknown> = {};
      if (input.userId) where.userId = input.userId;
      if (input.query) {
        where.invoiceNumber = { contains: input.query, mode: "insensitive" };
      }

      const invoices = await prisma.invoice.findMany({
        where,
        include: {
          user: { select: { firstname: true, lastname: true } },
          payment: { select: { amount: true, paymentMode: true, createdAt: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      return JSON.stringify(
        invoices.map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          status: inv.status,
          member: `${inv.user.firstname} ${inv.user.lastname}`,
          amount: Number(inv.payment.amount),
          paymentMode: inv.payment.paymentMode,
          date: inv.createdAt.toISOString(),
        }))
      );
    },
  }),
];
