import { tool } from "@openai/agents";
import { z } from "zod";
import { n } from "./utils";
import {
  createGiftCard,
  checkBalance,
  getGiftCards,
} from "@/lib/actions/gift-cards";

export const giftCardTools = [
  tool({
    name: "create_gift_card",
    description: "Create a new gift card with a unique code. Admin only. Requires confirmation.",
    parameters: z.object({
      amount: z.number().describe("Gift card value in INR"),
      recipientName: z.string().nullable().describe("Recipient name"),
      recipientPhone: z.string().nullable().describe("Recipient phone"),
      purchaserId: z.number().nullable().describe("Purchaser user ID"),
      expiresAt: z.string().nullable().describe("Expiry date ISO string"),
    }),
    async execute(input) {
      const result = await createGiftCard(n(input));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "check_gift_card_balance",
    description: "Check the balance and details of a gift card by code.",
    parameters: z.object({
      code: z.string().describe("8-character gift card code"),
    }),
    async execute(input) {
      const result = await checkBalance(input.code);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_gift_cards",
    description: "List all gift cards, optionally filtered by status (active, redeemed, expired).",
    parameters: z.object({
      status: z.string().nullable().describe("Filter by status: active, redeemed, expired"),
    }),
    async execute(input) {
      const result = await getGiftCards(input.status ?? undefined);
      return JSON.stringify(result);
    },
  }),
];
