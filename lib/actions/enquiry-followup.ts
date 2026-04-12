"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  addFollowup as addFollowupService,
  getFollowupHistory as getFollowupHistoryService,
  getOverdueEnquiryFollowups as getOverdueService,
  getTodayFollowups as getTodayService,
  assignEnquiry as assignEnquiryService,
} from "@/lib/services/enquiry-followup";

export async function addFollowup(data: {
  enquiryId: number;
  action: string;
  outcome: string;
  notes?: string;
  nextFollowupAt?: string;
}) {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  return addFollowupService({
    enquiryId: data.enquiryId,
    workerId: parseInt(session.user.id, 10),
    action: data.action,
    outcome: data.outcome,
    notes: data.notes,
    nextFollowupAt: data.nextFollowupAt ? new Date(data.nextFollowupAt) : undefined,
  });
}

export async function getFollowupHistory(enquiryId: number) {
  try {
    await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  return getFollowupHistoryService(enquiryId);
}

export async function getOverdueEnquiryFollowups(workerId?: number) {
  try {
    await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  return getOverdueService(workerId);
}

export async function getTodayFollowups(workerId?: number) {
  try {
    await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  return getTodayService(workerId);
}

export async function assignEnquiry(enquiryId: number, workerId: number) {
  try {
    await requireWorker(["admin"]);
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  return assignEnquiryService(enquiryId, workerId);
}
