import { prisma } from "@/lib/prisma";

export async function calculatePayroll(data: {
  workerId: number;
  month: number;
  year: number;
  baseSalary: number;
  bonus?: number;
  deductions?: number;
}) {
  try {
    // Auto-compute commission: sum of payments collected by this worker in the month * 2%
    const start = new Date(data.year, data.month - 1, 1);
    const end = new Date(data.year, data.month, 1);

    const paymentsResult = await prisma.payment.aggregate({
      where: {
        collectedById: data.workerId,
        createdAt: { gte: start, lt: end },
      },
      _sum: { amount: true },
    });

    const totalCollected = paymentsResult._sum.amount
      ? Number(paymentsResult._sum.amount)
      : 0;
    const commissionRate = 0.02;
    const commission = Math.round(totalCollected * commissionRate * 100) / 100;

    const bonus = data.bonus ?? 0;
    const deductions = data.deductions ?? 0;
    const netPayable = data.baseSalary + commission + bonus - deductions;

    const payroll = await prisma.payroll.upsert({
      where: {
        workerId_month_year: {
          workerId: data.workerId,
          month: data.month,
          year: data.year,
        },
      },
      create: {
        workerId: data.workerId,
        month: data.month,
        year: data.year,
        baseSalary: data.baseSalary,
        commission,
        bonus,
        deductions,
        netPayable,
      },
      update: {
        baseSalary: data.baseSalary,
        commission,
        bonus,
        deductions,
        netPayable,
      },
    });

    return {
      success: true,
      payroll: {
        id: payroll.id,
        workerId: payroll.workerId,
        month: payroll.month,
        year: payroll.year,
        baseSalary: Number(payroll.baseSalary),
        commission: Number(payroll.commission),
        bonus: Number(payroll.bonus),
        deductions: Number(payroll.deductions),
        netPayable: Number(payroll.netPayable),
        totalCollected,
        status: payroll.status,
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to calculate payroll" };
  }
}

export async function getPayrollSummary(month: number, year: number) {
  try {
    const payrolls = await prisma.payroll.findMany({
      where: { month, year },
      include: {
        worker: { select: { firstname: true, lastname: true, role: true } },
      },
      orderBy: { worker: { firstname: "asc" } },
    });

    return payrolls.map((p) => ({
      id: p.id,
      workerId: p.workerId,
      workerName: `${p.worker.firstname} ${p.worker.lastname}`,
      role: p.worker.role,
      baseSalary: Number(p.baseSalary),
      commission: Number(p.commission),
      bonus: Number(p.bonus),
      deductions: Number(p.deductions),
      netPayable: Number(p.netPayable),
      status: p.status,
      paidAt: p.paidAt?.toISOString() ?? null,
    }));
  } catch {
    return [];
  }
}

export async function processPayroll(id: number) {
  try {
    const payroll = await prisma.payroll.findUnique({ where: { id } });
    if (!payroll) return { success: false, error: "Payroll record not found" };

    if (payroll.status === "paid") return { success: false, error: "Already paid" };

    const newStatus = payroll.status === "pending" ? "processed" : "paid";
    const updateData: Record<string, unknown> = { status: newStatus };
    if (newStatus === "paid") updateData.paidAt = new Date();

    const updated = await prisma.payroll.update({
      where: { id },
      data: updateData,
    });

    return {
      success: true,
      payroll: {
        id: updated.id,
        status: updated.status,
        paidAt: updated.paidAt?.toISOString() ?? null,
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to process payroll" };
  }
}
