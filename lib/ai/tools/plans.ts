import { tool } from "@openai/agents";
import { z } from "zod";
import { n } from "./utils";
import { getPlans, createPlan, updatePlan, togglePlanActive } from "@/lib/actions/plans";
import {
  getPromoCodes,
  createPromoCode,
  togglePromoCode,
  validatePromoCode,
} from "@/lib/actions/promos";

export const planTools = [
  tool({
    name: "get_plans",
    description: "List all membership plans",
    parameters: z.object({}),
    async execute() {
      const plans = await getPlans();
      return JSON.stringify(plans);
    },
  }),

  tool({
    name: "create_plan",
    description: "Create a new membership plan. Requires confirmation.",
    parameters: z.object({
      name: z.string().describe("Plan name"),
      expireDays: z.number().describe("Duration in days"),
      price: z.number().describe("Price in INR"),
      occasions: z.number().nullable().describe("Max visits (null for unlimited)"),
    }),
    async execute(input) {
      const result = await createPlan(n(input));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "update_plan",
    description: "Update an existing plan. Requires confirmation.",
    parameters: z.object({
      planId: z.number().describe("Plan ID"),
      name: z.string().describe("Plan name"),
      expireDays: z.number().describe("Duration in days"),
      price: z.number().describe("Price in INR"),
      occasions: z.number().nullable().describe("Max visits"),
    }),
    async execute(input) {
      const { planId, ...data } = input;
      const result = await updatePlan(planId, n(data));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "toggle_plan_active",
    description: "Activate or deactivate a membership plan. Requires confirmation.",
    parameters: z.object({
      planId: z.number().describe("Plan ID"),
    }),
    async execute(input) {
      const result = await togglePlanActive(input.planId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_promo_codes",
    description: "List all promo codes",
    parameters: z.object({}),
    async execute() {
      const promos = await getPromoCodes();
      return JSON.stringify(promos);
    },
  }),

  tool({
    name: "create_promo_code",
    description: "Create a new promo code. Requires confirmation.",
    parameters: z.object({
      code: z.string().describe("Promo code string"),
      discountType: z.string().describe("Type: percentage or fixed"),
      discountValue: z.number().describe("Discount value"),
      maxUses: z.number().nullable().describe("Max redemptions"),
      validFrom: z.string().describe("Start date YYYY-MM-DD"),
      validTo: z.string().describe("End date YYYY-MM-DD"),
      planIds: z.string().nullable().describe("Comma-separated plan IDs this promo applies to"),
    }),
    async execute(input) {
      const result = await createPromoCode(n(input));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "toggle_promo_code",
    description: "Activate or deactivate a promo code. Requires confirmation.",
    parameters: z.object({
      promoId: z.number().describe("Promo code ID"),
      isActive: z.boolean().describe("Set active state"),
    }),
    async execute(input) {
      const result = await togglePromoCode(input.promoId, input.isActive);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "validate_promo",
    description: "Check if a promo code is valid for a specific plan",
    parameters: z.object({
      code: z.string().describe("Promo code"),
      planId: z.number().describe("Plan ID to check against"),
    }),
    async execute(input) {
      const result = await validatePromoCode(input.code, input.planId);
      return JSON.stringify(result);
    },
  }),
];
