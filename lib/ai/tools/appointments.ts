import { tool } from "@openai/agents";
import { z } from "zod";
import {
  bookAppointmentAction,
  cancelAppointmentAction,
  getAppointmentsAction,
  getTrainerAvailabilityAction,
} from "@/lib/actions/appointments";

export const appointmentTools = [
  tool({
    name: "book_appointment",
    description:
      "Book an appointment for a member with a trainer at a specific date and time slot. Requires confirmation before executing.",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
      trainerId: z.number().describe("Trainer (worker) ID"),
      date: z.string().describe("Date in YYYY-MM-DD format"),
      startTime: z.string().describe("Start time in HH:MM format (e.g. 09:00)"),
      endTime: z.string().describe("End time in HH:MM format (e.g. 09:30)"),
      notes: z.string().optional().describe("Optional notes"),
    }),
    async execute(input) {
      const result = await bookAppointmentAction({
        userId: input.userId,
        trainerId: input.trainerId,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        notes: input.notes,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "cancel_appointment",
    description:
      "Cancel an existing appointment by its ID. Requires confirmation before executing.",
    parameters: z.object({
      appointmentId: z.number().describe("Appointment ID to cancel"),
    }),
    async execute(input) {
      const result = await cancelAppointmentAction(input.appointmentId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_appointments",
    description:
      "List appointments with optional filters by member, trainer, date, or status",
    parameters: z.object({
      userId: z.number().optional().describe("Filter by member ID"),
      trainerId: z.number().optional().describe("Filter by trainer ID"),
      date: z.string().optional().describe("Filter by date (YYYY-MM-DD)"),
      status: z
        .enum(["booked", "completed", "cancelled", "no_show"])
        .optional()
        .describe("Filter by status"),
    }),
    async execute(input) {
      const result = await getAppointmentsAction({
        userId: input.userId,
        trainerId: input.trainerId,
        date: input.date,
        status: input.status,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_trainer_availability",
    description:
      "Check a trainer's booked slots on a given date to find available times",
    parameters: z.object({
      trainerId: z.number().describe("Trainer (worker) ID"),
      date: z.string().describe("Date in YYYY-MM-DD format"),
    }),
    async execute(input) {
      const result = await getTrainerAvailabilityAction(
        input.trainerId,
        input.date
      );
      return JSON.stringify(result);
    },
  }),
];
