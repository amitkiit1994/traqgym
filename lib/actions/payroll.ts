"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  calculatePayroll as calculatePayrollService,
  getPayrollSummary as getPayrollSummaryService,
  processPayroll as processPayrollService,
} from "@/lib/services/payroll";

export async function calculatePayroll(data: {
  workerId: number;
  month: number;
  year: number;
  baseSalary: number;
  bonus?: number;
  deductions?: number;
}) {
  try { await requireWorker(["admin"]); } catch { return { success: false, error: "Unauthorized" }; }
  return calculatePayrollService(data);
}

export async function getPayrollSummary(month: number, year: number) {
  try { await requireWorker(); } catch { return []; }
  return getPayrollSummaryService(month, year);
}

export async function processPayroll(id: number) {
  try { await requireWorker(["admin"]); } catch { return { success: false, error: "Unauthorized" }; }
  return processPayrollService(id);
}
