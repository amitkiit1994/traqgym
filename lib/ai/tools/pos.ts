import { tool } from "@openai/agents";
import { z } from "zod";
import {
  getProductsAction,
  sellProductAction,
  restockProductAction,
  getSalesReportAction,
  getLowStockAction,
} from "@/lib/actions/pos";

export const posTools = [
  tool({
    name: "get_products",
    description: "List active products in the shop/POS inventory, optionally filtered by category",
    parameters: z.object({
      category: z.string().nullable().describe("Filter by category (e.g. supplements, apparel, general)"),
    }),
    async execute(input) {
      const products = await getProductsAction(input.category ?? undefined);
      return JSON.stringify(products);
    },
  }),

  tool({
    name: "sell_product",
    description: "Record a product sale. Checks stock, creates sale record, and reduces inventory. Requires confirmation.",
    parameters: z.object({
      productId: z.number().describe("Product ID"),
      quantity: z.number().describe("Quantity to sell"),
      userId: z.number().nullable().describe("Member ID if sold to a member"),
      paymentMode: z.string().describe("Payment mode: cash, upi, card"),
      locationId: z.number().nullable().describe("Location ID"),
      soldById: z.number().nullable().describe("Worker ID who made the sale"),
    }),
    async execute(input) {
      const result = await sellProductAction({
        productId: input.productId,
        quantity: input.quantity,
        userId: input.userId ?? undefined,
        paymentMode: input.paymentMode,
        locationId: input.locationId ?? undefined,
        soldById: input.soldById ?? undefined,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "restock_product",
    description: "Add stock to a product. Creates an inventory log entry.",
    parameters: z.object({
      productId: z.number().describe("Product ID"),
      quantity: z.number().describe("Quantity to add"),
      reason: z.string().nullable().describe("Reason for restock"),
    }),
    async execute(input) {
      const result = await restockProductAction(
        input.productId,
        input.quantity,
        input.reason ?? undefined
      );
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_sales_report",
    description: "Get sales report for a date range, aggregated by product with total revenue",
    parameters: z.object({
      startDate: z.string().describe("Start date YYYY-MM-DD"),
      endDate: z.string().describe("End date YYYY-MM-DD"),
      locationId: z.number().nullable().describe("Filter by location"),
    }),
    async execute(input) {
      const report = await getSalesReportAction(
        input.startDate,
        input.endDate,
        input.locationId ?? undefined
      );
      return JSON.stringify(report);
    },
  }),

  tool({
    name: "get_low_stock",
    description: "Get products with stock at or below a threshold (default 5)",
    parameters: z.object({
      threshold: z.number().nullable().describe("Stock threshold (default 5)"),
    }),
    async execute(input) {
      const products = await getLowStockAction(input.threshold ?? undefined);
      return JSON.stringify(products);
    },
  }),
];
