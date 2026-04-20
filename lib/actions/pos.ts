"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  getProducts,
  sellProduct,
  restockProduct,
  getSalesReport,
  getLowStock,
} from "@/lib/services/pos";

export async function getProductsAction(category?: string) {
  try { await requireWorker(); } catch { return []; }
  const products = await getProducts(category);
  return products.map((p) => ({ ...p, price: Number(p.price) }));
}

export async function sellProductAction(params: {
  productId: number;
  quantity: number;
  userId?: number;
  paymentMode: string;
  locationId?: number;
  soldById?: number;
}) {
  let session;
  try { session = await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  // Default soldById/locationId from the session so the Payment ledger row
  // (H6) and shift attribution (H7) work even if the UI omits them.
  const sessionWorkerId = parseInt(session.user.id, 10);
  const sessionLocationId = session.user.locationId ?? undefined;
  const merged = {
    ...params,
    soldById: params.soldById ?? (Number.isFinite(sessionWorkerId) ? sessionWorkerId : undefined),
    locationId: params.locationId ?? sessionLocationId,
  };
  try {
    return await sellProduct(merged);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function restockProductAction(
  productId: number,
  quantity: number,
  reason?: string
) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  try {
    return await restockProduct(productId, quantity, reason);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function getSalesReportAction(
  startDate: string,
  endDate: string,
  locationId?: number
) {
  try { await requireWorker(); } catch { return { products: [], totalRevenue: 0, totalSales: 0 }; }
  return getSalesReport(new Date(startDate), new Date(endDate), locationId);
}

export async function getLowStockAction(threshold?: number) {
  try { await requireWorker(); } catch { return []; }
  const products = await getLowStock(threshold);
  return products.map((p) => ({ ...p, price: Number(p.price) }));
}
