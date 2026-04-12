import { prisma } from "@/lib/prisma";

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
