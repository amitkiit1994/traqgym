import { prisma } from "@/lib/prisma";
import { getOpenShiftFor } from "@/lib/services/cash-shift";
import { computeGstSplitInclusive, getGymGstRate } from "@/lib/services/tax";

export async function getProducts(category?: string) {
  return prisma.product.findMany({
    where: {
      isActive: true,
      ...(category ? { category } : {}),
    },
    orderBy: { name: "asc" },
  });
}

export async function sellProduct(params: {
  productId: number;
  quantity: number;
  userId?: number;
  paymentMode: string;
  locationId?: number;
  soldById?: number;
}) {
  // H7 — pre-resolve open shift at the seller's location so cash sales tag
  // automatically. Lookup outside the txn is safe: closeShift is idempotent
  // and tolerates a payment posting one slot late; we still re-check status
  // inside the txn to avoid tagging a shift that just closed.
  let resolvedShiftId: number | null = null;
  if (params.locationId != null) {
    const open = await getOpenShiftFor(params.locationId);
    if (open) resolvedShiftId = open.id;
    else {
      // Don't block sale; just log so ops can spot drawer-untagged cash.
      console.warn(
        `[pos.sellProduct] No open shift at location ${params.locationId}; sale will not be drawer-attributed.`
      );
    }
  }

  // GST rate read once outside the txn — POS prices are tax-inclusive, so the
  // Payment row must carry the split for Tally / GSTR-1.
  const gymGstRate = await getGymGstRate();

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: params.productId },
    });
    if (!product) {
      return { success: false as const, error: "Product not found" };
    }
    if (!product.isActive) {
      return { success: false as const, error: "Product is not active" };
    }
    if (product.stock < params.quantity) {
      return {
        success: false as const,
        error: `Insufficient stock. Available: ${product.stock}, requested: ${params.quantity}`,
      };
    }

    const totalAmount = Number(product.price) * params.quantity;

    // Re-check the open shift inside the txn so we never tag a shift that
    // closed between our pre-lookup and the insert.
    let shiftIdToUse: number | null = null;
    if (resolvedShiftId != null) {
      const stillOpen = await tx.cashShift.findFirst({
        where: { id: resolvedShiftId, status: "open" },
        select: { id: true },
      });
      shiftIdToUse = stillOpen ? resolvedShiftId : null;
    }

    // H6 — record the corresponding Payment row so cashflow + reports
    // include POS revenue. soldById is the worker; required by Payment.
    let paymentIdToUse: number | null = null;
    if (params.soldById != null) {
      const gstSplit = computeGstSplitInclusive(totalAmount, gymGstRate);
      const payment = await tx.payment.create({
        data: {
          userId: params.userId ?? null,
          memberTicketId: null,
          locationId: params.locationId ?? null,
          amount: totalAmount,
          paymentMode: params.paymentMode,
          collectedById: params.soldById,
          paymentStatus: "full",
          paymentFor: "pos_sale",
          shiftId: params.paymentMode === "cash" ? shiftIdToUse : null,
          baseAmount: gstSplit.baseAmount,
          taxRate: gstSplit.taxRate,
          taxAmount: gstSplit.taxAmount,
        },
      });
      paymentIdToUse = payment.id;
    }

    const sale = await tx.sale.create({
      data: {
        productId: params.productId,
        quantity: params.quantity,
        unitPrice: product.price,
        totalAmount,
        userId: params.userId ?? null,
        paymentMode: params.paymentMode,
        locationId: params.locationId ?? null,
        soldById: params.soldById ?? null,
        shiftId: shiftIdToUse,
        paymentId: paymentIdToUse,
      },
    });

    await tx.inventoryLog.create({
      data: {
        productId: params.productId,
        change: -params.quantity,
        reason: "sale",
      },
    });

    await tx.product.update({
      where: { id: params.productId },
      data: { stock: { decrement: params.quantity } },
    });

    return { success: true as const, sale };
  });
}

export async function restockProduct(
  productId: number,
  quantity: number,
  reason?: string
) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });
  if (!product) {
    return { success: false as const, error: "Product not found" };
  }

  return prisma.$transaction(async (tx) => {
    await tx.inventoryLog.create({
      data: {
        productId,
        change: quantity,
        reason: reason ?? "restock",
      },
    });

    const updated = await tx.product.update({
      where: { id: productId },
      data: { stock: { increment: quantity } },
    });

    return { success: true as const, product: updated };
  });
}

export async function getSalesReport(
  startDate: Date,
  endDate: Date,
  locationId?: number
) {
  const sales = await prisma.sale.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
      ...(locationId ? { locationId } : {}),
    },
    include: { product: { select: { name: true, category: true } } },
  });

  const byProduct: Record<
    number,
    { productName: string; category: string; totalQty: number; totalRevenue: number }
  > = {};

  let totalRevenue = 0;

  for (const s of sales) {
    if (!byProduct[s.productId]) {
      byProduct[s.productId] = {
        productName: s.product.name,
        category: s.product.category,
        totalQty: 0,
        totalRevenue: 0,
      };
    }
    byProduct[s.productId].totalQty += s.quantity;
    byProduct[s.productId].totalRevenue += Number(s.totalAmount);
    totalRevenue += Number(s.totalAmount);
  }

  return {
    products: Object.values(byProduct),
    totalRevenue,
    totalSales: sales.length,
  };
}

export async function getLowStock(threshold: number = 5) {
  return prisma.product.findMany({
    where: {
      isActive: true,
      stock: { lte: threshold },
    },
    orderBy: { stock: "asc" },
  });
}
