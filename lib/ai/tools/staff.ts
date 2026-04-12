import { tool } from "@openai/agents";
import { z } from "zod";
import { n } from "./utils";
import {
  getWorkers,
  createWorker,
  updateWorker,
  toggleWorkerActive,
} from "@/lib/actions/workers";
import { resetWorkerPassword, resetMemberPassword } from "@/lib/actions/password";
import {
  getLeaveRequests,
  createLeaveRequest,
  reviewLeaveRequest,
  getLeaveBalance,
} from "@/lib/actions/leaves";
import { getStaffPerformanceAction } from "@/lib/actions/staff-performance";

export const staffTools = [
  tool({
    name: "get_workers",
    description: "List all staff members. Admin only.",
    parameters: z.object({}),
    async execute() {
      const workers = await getWorkers();
      return JSON.stringify(workers);
    },
  }),

  tool({
    name: "create_worker",
    description: "Add a new staff member. Admin only. Requires confirmation.",
    parameters: z.object({
      email: z.string().describe("Email"),
      password: z.string().describe("Initial password"),
      firstname: z.string().describe("First name"),
      lastname: z.string().describe("Last name"),
      role: z.string().describe("Role: admin or staff"),
      locationId: z.number().nullable().describe("Location ID"),
    }),
    async execute(input) {
      const result = await createWorker(n(input));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "update_worker",
    description: "Update a staff member's details. Admin only. Requires confirmation.",
    parameters: z.object({
      workerId: z.number().describe("Worker ID"),
      firstname: z.string().describe("First name"),
      lastname: z.string().describe("Last name"),
      email: z.string().describe("Email"),
      role: z.string().describe("Role"),
      locationId: z.number().nullable().describe("Location ID"),
      password: z.string().nullable().describe("New password (optional)"),
    }),
    async execute(input) {
      const { workerId, ...data } = input;
      const result = await updateWorker(workerId, n(data));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "toggle_worker_active",
    description: "Activate or deactivate a staff member. Admin only. Requires confirmation.",
    parameters: z.object({
      workerId: z.number().describe("Worker ID"),
    }),
    async execute(input) {
      const result = await toggleWorkerActive(input.workerId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "reset_worker_password",
    description: "Reset a staff member's password. Admin only. Requires confirmation.",
    parameters: z.object({
      workerId: z.number().describe("Worker ID"),
      newPassword: z.string().describe("New password"),
    }),
    async execute(input) {
      const result = await resetWorkerPassword(input.workerId, input.newPassword);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "reset_member_password",
    description: "Reset a member's password. Requires confirmation.",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
      newPassword: z.string().describe("New password"),
    }),
    async execute(input) {
      const result = await resetMemberPassword(input.userId, input.newPassword);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_leave_requests",
    description: "Get staff leave requests with optional status filter",
    parameters: z.object({
      status: z.string().nullable().describe("Filter: pending, approved, rejected"),
    }),
    async execute(input) {
      const requests = await getLeaveRequests(input.status ?? undefined);
      return JSON.stringify(requests);
    },
  }),

  tool({
    name: "create_leave_request",
    description: "Submit a leave request for a staff member. Requires confirmation.",
    parameters: z.object({
      workerId: z.number().describe("Worker ID"),
      leaveType: z.string().describe("Type: casual, sick, personal"),
      startDate: z.string().describe("Start date YYYY-MM-DD"),
      endDate: z.string().describe("End date YYYY-MM-DD"),
      reason: z.string().nullable().describe("Reason"),
    }),
    async execute(input) {
      const { workerId, ...data } = input;
      const result = await createLeaveRequest(workerId, n(data));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "review_leave",
    description: "Approve or reject a leave request. Admin only. Requires confirmation.",
    parameters: z.object({
      leaveId: z.number().describe("Leave request ID"),
      status: z.enum(["approved", "rejected"]).describe("Decision"),
      reviewedBy: z.number().describe("Admin worker ID reviewing"),
    }),
    async execute(input) {
      const result = await reviewLeaveRequest(input.leaveId, input.status, input.reviewedBy);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_leave_balance",
    description: "Get leave balance/quota for a staff member",
    parameters: z.object({
      workerId: z.number().describe("Worker ID"),
    }),
    async execute(input) {
      const balance = await getLeaveBalance(input.workerId);
      return JSON.stringify(balance);
    },
  }),

  tool({
    name: "get_staff_performance",
    description: "Get staff performance metrics for a month. Admin only.",
    parameters: z.object({
      monthStart: z.string().describe("Month start ISO date"),
      monthEnd: z.string().describe("Month end ISO date"),
    }),
    async execute(input) {
      const perf = await getStaffPerformanceAction(input.monthStart, input.monthEnd);
      return JSON.stringify(perf);
    },
  }),
];
