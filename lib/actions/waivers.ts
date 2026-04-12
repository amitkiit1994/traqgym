"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  createTemplate as createTemplateService,
  getTemplates as getTemplatesService,
  signWaiver as signWaiverService,
  getWaiverStatus as getWaiverStatusService,
  getUnsignedWaivers as getUnsignedWaiversService,
} from "@/lib/services/waivers";

export async function createTemplate(data: {
  name: string;
  content: string;
  required?: boolean;
}) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  return createTemplateService(data);
}

export async function getTemplates(activeOnly?: boolean) {
  try { await requireWorker(); } catch { return []; }
  return getTemplatesService(activeOnly);
}

export async function signWaiver(data: {
  userId: number;
  templateId: number;
  ipAddress?: string;
  signature?: string;
}) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  return signWaiverService(data);
}

export async function getWaiverStatus(userId: number) {
  try { await requireWorker(); } catch { return []; }
  return getWaiverStatusService(userId);
}

export async function getUnsignedWaivers(userId: number) {
  try { await requireWorker(); } catch { return []; }
  return getUnsignedWaiversService(userId);
}
