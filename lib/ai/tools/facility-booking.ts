import { tool } from "@openai/agents";
import { z } from "zod";
import {
  getAvailableSlotsAction,
  bookSlotAction,
  cancelBookingAction,
  getUserBookingsAction,
} from "@/lib/actions/facility-booking";

export const facilityBookingTools = [
  tool({
    name: "get_available_slots",
    description: "Get available facility slots for a specific facility on a given date, showing capacity and booking count",
    parameters: z.object({
      facilityId: z.number().describe("Facility ID"),
      date: z.string().describe("Date in YYYY-MM-DD format"),
    }),
    async execute(input) {
      const slots = await getAvailableSlotsAction(input.facilityId, input.date);
      return JSON.stringify(slots);
    },
  }),

  tool({
    name: "book_facility_slot",
    description: "Book a facility slot for a member. Checks capacity before booking. Requires confirmation.",
    parameters: z.object({
      slotId: z.number().describe("Facility slot ID"),
      userId: z.number().describe("Member ID"),
    }),
    async execute(input) {
      const result = await bookSlotAction(input.slotId, input.userId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "cancel_facility_booking",
    description: "Cancel a facility booking. Updates slot status if it was full.",
    parameters: z.object({
      bookingId: z.number().describe("Booking ID to cancel"),
    }),
    async execute(input) {
      const result = await cancelBookingAction(input.bookingId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_facility_bookings",
    description: "Get upcoming facility bookings for a member",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
    }),
    async execute(input) {
      const bookings = await getUserBookingsAction(input.userId);
      return JSON.stringify(bookings);
    },
  }),
];
