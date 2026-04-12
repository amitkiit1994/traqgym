"use server";

import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/auth-guard";
import * as notification from "@/lib/services/notification";
import * as whatsapp from "@/lib/channels/whatsapp";
import * as sms from "@/lib/channels/sms";

export async function getNotificationLogs(params?: {
  status?: string;
  channel?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}) {
  try { await requireWorker(); } catch { return []; }

  const where: Record<string, unknown> = {};
  if (params?.status) where.status = params.status;
  if (params?.channel) where.channel = params.channel;

  if (params?.dateFrom || params?.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (params?.dateFrom) dateFilter.gte = new Date(params.dateFrom);
    if (params?.dateTo) {
      const to = new Date(params.dateTo);
      to.setHours(23, 59, 59, 999);
      dateFilter.lte = to;
    }
    where.deliveryDate = dateFilter;
  }

  if (params?.search) {
    where.user = {
      OR: [
        { firstname: { contains: params.search, mode: "insensitive" } },
        { lastname: { contains: params.search, mode: "insensitive" } },
      ],
    };
  }

  const logs = await prisma.notificationLog.findMany({
    where,
    include: {
      user: { select: { firstname: true, lastname: true } },
    },
    orderBy: { createdAt: "desc" },
    take: params?.limit ?? 50,
    skip: params?.offset ?? 0,
  });

  return logs.map((log) => ({
    id: log.id,
    memberName: `${log.user.firstname} ${log.user.lastname}`,
    templateName: log.templateName,
    channel: log.channel,
    recipient: log.recipient,
    status: log.status,
    errorMessage: log.errorMessage,
    deliveryDate: log.deliveryDate.toISOString(),
    sentAt: log.sentAt?.toISOString() ?? null,
    createdAt: log.createdAt.toISOString(),
  }));
}

export async function getNotificationAnalytics(params?: {
  dateFrom?: string;
  dateTo?: string;
}) {
  try { await requireWorker(); } catch { return null; }

  const where: Record<string, unknown> = {};
  if (params?.dateFrom || params?.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (params?.dateFrom) dateFilter.gte = new Date(params.dateFrom);
    if (params?.dateTo) {
      const to = new Date(params.dateTo);
      to.setHours(23, 59, 59, 999);
      dateFilter.lte = to;
    }
    where.deliveryDate = dateFilter;
  }

  const [total, sent, failed, pending] = await Promise.all([
    prisma.notificationLog.count({ where }),
    prisma.notificationLog.count({ where: { ...where, status: "sent" } }),
    prisma.notificationLog.count({ where: { ...where, status: "failed" } }),
    prisma.notificationLog.count({ where: { ...where, status: "pending" } }),
  ]);

  const byChannel = await prisma.notificationLog.groupBy({
    by: ["channel"],
    where,
    _count: { id: true },
  });

  const channelBreakdown = byChannel.map((c) => ({
    channel: c.channel,
    count: c._count.id,
  }));

  return {
    total,
    sent,
    failed,
    pending,
    successRate: total > 0 ? Math.round((sent / total) * 100) : 0,
    channelBreakdown,
  };
}

export async function resendFailedNotification(id: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }

  const log = await prisma.notificationLog.findUnique({
    where: { id },
    include: { user: { select: { firstname: true, lastname: true, phone: true } } },
  });

  if (!log) return { success: false, error: "Notification not found" };
  if (log.status !== "failed") return { success: false, error: "Only failed notifications can be resent" };
  if (!log.recipient) return { success: false, error: "No recipient on record" };

  const variables = {
    memberName: `${log.user.firstname} ${log.user.lastname}`,
  };

  let result: { success: boolean; error?: string };
  try {
    if (log.channel === "whatsapp") {
      result = await whatsapp.send({
        recipient: log.recipient,
        templateName: log.templateName,
        variables,
      });
    } else if (log.channel === "sms") {
      result = await sms.send({
        recipient: log.recipient,
        templateName: log.templateName,
        variables,
      });
    } else {
      return { success: false, error: `Resend not supported for channel: ${log.channel}` };
    }

    if (result.success) {
      await notification.markSent(log.id);
      return { success: true };
    } else {
      await notification.markFailed(log.id, result.error || "Resend failed");
      return { success: false, error: result.error || "Resend failed" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await notification.markFailed(log.id, msg);
    return { success: false, error: msg };
  }
}

export async function exportNotificationLogsCsv(params?: {
  status?: string;
  channel?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  try { await requireWorker(); } catch { return ""; }

  const where: Record<string, unknown> = {};
  if (params?.status) where.status = params.status;
  if (params?.channel) where.channel = params.channel;

  if (params?.dateFrom || params?.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (params?.dateFrom) dateFilter.gte = new Date(params.dateFrom);
    if (params?.dateTo) {
      const to = new Date(params.dateTo);
      to.setHours(23, 59, 59, 999);
      dateFilter.lte = to;
    }
    where.deliveryDate = dateFilter;
  }

  if (params?.search) {
    where.user = {
      OR: [
        { firstname: { contains: params.search, mode: "insensitive" } },
        { lastname: { contains: params.search, mode: "insensitive" } },
      ],
    };
  }

  const logs = await prisma.notificationLog.findMany({
    where,
    include: {
      user: { select: { firstname: true, lastname: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const header = "Member,Template,Channel,Recipient,Status,Error,Date,Sent At";
  const rows = logs.map((log) => {
    const name = `${log.user.firstname} ${log.user.lastname}`;
    const template = log.templateName.replace(/_/g, " ");
    const date = log.deliveryDate.toISOString().split("T")[0];
    const sentAt = log.sentAt ? log.sentAt.toISOString() : "";
    const error = (log.errorMessage || "").replace(/,/g, ";").replace(/\n/g, " ");
    return `"${name}","${template}",${log.channel},${log.recipient || ""},${log.status},"${error}",${date},${sentAt}`;
  });

  return [header, ...rows].join("\n");
}
