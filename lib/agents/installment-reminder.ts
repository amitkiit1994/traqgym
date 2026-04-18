import { prisma } from "@/lib/prisma";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { send as sendSMS } from "@/lib/channels/sms";
import { getSetting } from "@/lib/services/settings";
import { notifyWorkersByRole } from "@/lib/services/in-app-notification";
import { todayIST } from "@/lib/utils/date";
import {
  getOverdueInstallments,
  markReminderSent,
} from "@/lib/services/payment-schedule";

const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Sends WhatsApp/SMS reminders for installments due in next 3 days
 * (warn) and overdue (escalate). Idempotent within a 24h window.
 */
export async function runInstallmentReminder(): Promise<{
  remindersSent: number;
  insightsCreated: number;
}> {
  const channel = await getSetting("notification_channel", "whatsapp");
  const today = todayIST();
  const cooldownThreshold = new Date(Date.now() - REMINDER_COOLDOWN_MS);

  // Pull installments due within next 3 days (includes already-overdue ones)
  const candidates = await getOverdueInstallments({ daysAhead: 3 });

  let remindersSent = 0;
  let insightsCreated = 0;
  const remindedInstallmentIds: number[] = [];
  const overdueScheduleIds = new Set<number>();
  const overdueMembers: Array<{ name: string; amount: number; days: number }> = [];

  for (const inst of candidates) {
    // Idempotency: skip if a reminder went out within the last 24h
    if (inst.reminderSentAt && inst.reminderSentAt > cooldownThreshold) continue;
    if (!inst.user.phone) continue;

    const isOverdue = inst.isOverdue;
    const daysFromToday = Math.round(
      (inst.dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );
    const templateName = isOverdue
      ? "installment_overdue"
      : "installment_due_soon";

    const memberName = `${inst.user.firstname} ${inst.user.lastname}`;
    const remainingAmount = inst.amount - inst.paidAmount;
    const variables = {
      name: memberName,
      plan: inst.planName,
      amount: remainingAmount.toLocaleString("en-IN"),
      dueDate: inst.dueDate.toISOString().split("T")[0],
      sequence: String(inst.sequenceNumber),
    };

    let dispatched = false;
    try {
      if (channel === "whatsapp" || channel === "both") {
        await sendWhatsApp({
          recipient: inst.user.phone,
          templateName,
          variables,
        });
        dispatched = true;
      }
      if (channel === "sms" || channel === "both") {
        await sendSMS({
          recipient: inst.user.phone,
          templateName,
          variables,
        });
        dispatched = true;
      }
      if (channel !== "whatsapp" && channel !== "both" && channel !== "sms") {
        // Default fallback: WhatsApp
        await sendWhatsApp({
          recipient: inst.user.phone,
          templateName,
          variables,
        });
        dispatched = true;
      }
    } catch (err) {
      // Channel failures should not crash the cron — log and continue
      console.error("[InstallmentReminder] channel send failed:", err);
    }

    if (dispatched) {
      remindersSent++;
      remindedInstallmentIds.push(inst.installmentId);

      if (isOverdue) {
        overdueScheduleIds.add(inst.scheduleId);
        overdueMembers.push({
          name: memberName,
          amount: remainingAmount,
          days: Math.abs(daysFromToday),
        });
      }
    }
  }

  if (remindedInstallmentIds.length > 0) {
    await markReminderSent(remindedInstallmentIds);
  }

  // Create an insight for admins about overdue installments
  if (overdueMembers.length > 0) {
    try {
      const sample = overdueMembers
        .slice(0, 3)
        .map((m) => `${m.name} (Rs ${m.amount.toLocaleString("en-IN")})`)
        .join(", ");
      const more = overdueMembers.length > 3 ? ` and ${overdueMembers.length - 3} more` : "";
      await notifyWorkersByRole({
        role: "admin",
        type: "insight",
        title: `${overdueMembers.length} installment${overdueMembers.length === 1 ? "" : "s"} overdue`,
        message: `${sample}${more}`,
        link: "/admin/payment-schedules",
      });
      insightsCreated++;

      // Mark schedules with overdue installments as "defaulted" if heavily overdue (>14 days)
      const heavilyOverdue = candidates.filter(
        (c) =>
          c.isOverdue &&
          (today.getTime() - c.dueDate.getTime()) / (1000 * 60 * 60 * 24) > 14
      );
      const heavilyOverdueScheduleIds = Array.from(
        new Set(heavilyOverdue.map((c) => c.scheduleId))
      );
      if (heavilyOverdueScheduleIds.length > 0) {
        await prisma.paymentSchedule.updateMany({
          where: { id: { in: heavilyOverdueScheduleIds }, status: "active" },
          data: { status: "defaulted" },
        });
      }

      // Mark overdue installments status=overdue (for clearer reporting)
      const overdueInstIds = candidates
        .filter((c) => c.isOverdue && c.status === "pending")
        .map((c) => c.installmentId);
      if (overdueInstIds.length > 0) {
        await prisma.paymentInstallment.updateMany({
          where: { id: { in: overdueInstIds } },
          data: { status: "overdue" },
        });
      }
    } catch (err) {
      console.error("[InstallmentReminder] insight creation failed:", err);
    }
  }

  return { remindersSent, insightsCreated };
}
