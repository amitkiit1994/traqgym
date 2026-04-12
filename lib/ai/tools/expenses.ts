import { tool } from "@openai/agents";
import { z } from "zod";
import { n } from "./utils";
import {
  getExpenses,
  createExpense,
  updateExpense,
  getExpenseSummary,
} from "@/lib/actions/expenses";

export const expenseTools = [
  tool({
    name: "get_expenses",
    description: "List expenses with optional filters. Admin only.",
    parameters: z.object({
      month: z.string().nullable().describe("Month filter YYYY-MM"),
      locationId: z.number().nullable().describe("Filter by location"),
      category: z.string().nullable().describe("Filter by category"),
    }),
    async execute(input) {
      const expenses = await getExpenses(input.month ?? undefined, input.locationId ?? undefined, input.category ?? undefined);
      return JSON.stringify(expenses);
    },
  }),

  tool({
    name: "create_expense",
    description: "Record a new expense. Admin only. Requires confirmation.",
    parameters: z.object({
      category: z.string().describe("Category: rent, utilities, salaries, equipment, maintenance, marketing, other"),
      description: z.string().describe("Description"),
      amount: z.number().describe("Amount in INR"),
      expenseDate: z.string().describe("Date YYYY-MM-DD"),
      locationId: z.number().nullable().describe("Location ID"),
      paidBy: z.string().nullable().describe("Who paid"),
    }),
    async execute(input) {
      const result = await createExpense(n(input));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "update_expense",
    description: "Update an existing expense. Admin only. Requires confirmation.",
    parameters: z.object({
      expenseId: z.number().describe("Expense ID"),
      category: z.string().describe("Category"),
      description: z.string().describe("Description"),
      amount: z.number().describe("Amount"),
      expenseDate: z.string().describe("Date YYYY-MM-DD"),
      locationId: z.number().nullable().describe("Location ID"),
      paidBy: z.string().nullable().describe("Who paid"),
    }),
    async execute(input) {
      const { expenseId, ...data } = input;
      const result = await updateExpense(expenseId, n(data));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_expense_summary",
    description: "Get monthly expense breakdown by category. Admin only.",
    parameters: z.object({
      month: z.string().describe("Month YYYY-MM"),
      locationId: z.number().nullable().describe("Filter by location"),
    }),
    async execute(input) {
      const summary = await getExpenseSummary(input.month, input.locationId ?? undefined);
      return JSON.stringify(summary);
    },
  }),
];
