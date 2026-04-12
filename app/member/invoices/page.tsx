import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { InvoicesClient } from "./invoices-client";

export default async function MemberInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "member") {
    redirect("/login");
  }

  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const search = params.q || "";
  const perPage = 20;

  const userId = parseInt(session.user.id);

  const where: Record<string, unknown> = { userId };
  if (search) {
    where.invoiceNumber = { contains: search, mode: "insensitive" };
  }

  const [invoices, total, totalPaidResult] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        payment: { select: { amount: true, createdAt: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where: { userId, status: "paid" },
      include: { payment: { select: { amount: true } } },
    }),
  ]);

  const totalPaid = totalPaidResult.reduce(
    (sum, inv) => sum + Number(inv.payment.amount),
    0
  );

  return (
    <InvoicesClient
      invoices={invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: Number(inv.payment.amount),
        date: inv.payment.createdAt.toISOString(),
        status: inv.status,
      }))}
      totalPaid={totalPaid}
      page={page}
      totalPages={Math.max(1, Math.ceil(total / perPage))}
      search={search}
    />
  );
}
