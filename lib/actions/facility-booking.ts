"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  getFacilities,
  getAvailableSlots,
  bookSlot,
  cancelBooking,
  getUserBookings,
} from "@/lib/services/facility-booking";

export async function getFacilitiesAction(locationId?: number) {
  try { await requireWorker(); } catch { return []; }
  return getFacilities(locationId);
}

export async function getAvailableSlotsAction(facilityId: number, date: string) {
  try { await requireWorker(); } catch { return []; }
  return getAvailableSlots(facilityId, new Date(date));
}

export async function bookSlotAction(slotId: number, userId: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  try {
    return await bookSlot({ slotId, userId });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function cancelBookingAction(bookingId: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  try {
    return await cancelBooking(bookingId);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function getUserBookingsAction(userId: number) {
  try { await requireWorker(); } catch { return []; }
  return getUserBookings(userId);
}
