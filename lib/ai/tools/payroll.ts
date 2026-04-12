import { tool } from "@openai/agents";
import { z } from "zod";
import { n } from "./utils";
import {
  calculatePayroll,
  getPayrollSummary,
  processPayroll,
} from "@/lib/actions/payroll";

export const payrollTools = [
  tool({
    name: "calculate_payroll",
    description: "Calculate payroll for a worker for a given month. Auto-computes 2% commission from payments collected. Admin only.",
    parameters: z.object({
      workerId: z.number().describe("Worker ID"),
      month: z.number().describe("Month (1-12)"),
      year: z.number().describe("Year"),
      baseSalary: z.number().describe("Base salary in INR"),
      bonus: z.number().nullable().describe("Bonus amount"),
      deductions: z.number().nullable().describe("Deduction amount"),
    }),
    async execute(input) {
      const result = await calculatePayroll(n(input));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_payroll_summary",
    description: "Get payroll summary for all workers in a given month.",
    parameters: z.object({
      month: z.number().describe("Month (1-12)"),
      year: z.number().describe("Year"),
    }),
    async execute(input) {
      const result = await getPayrollSummary(input.month, input.year);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "process_payroll",
    description: "Process or mark payroll as paid. First call moves pending→processed, second call moves processed→paid. Admin only.",
    parameters: z.object({
      payrollId: z.number().describe("Payroll record ID"),
    }),
    async execute(input) {
      const result = await processPayroll(input.payrollId);
      return JSON.stringify(result);
    },
  }),
];
