"use server";

import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { requireWorker, requireAuth } from "@/lib/auth-guard";
import { resetPasswordSchema, changeSelfPasswordSchema, zodErrors } from "@/lib/validations";

export async function resetMemberPassword(userId: number, newPassword: string) {
  try { await requireWorker(["admin"]); } catch { return { errors: { password: "Unauthorized" } }; }
  const parsed = resetPasswordSchema.safeParse({ targetId: userId, newPassword });
  if (!parsed.success) return { errors: { password: Object.values(zodErrors(parsed.error))[0] } };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { errors: { password: "Member not found" } };

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashed },
  });

  await prisma.auditLog.create({
    data: {
      action: "password_reset",
      status: "success",
      details: JSON.stringify({ userId, type: "member" }),
      actorType: "worker",
    },
  });

  return { success: true };
}

export async function resetWorkerPassword(workerId: number, newPassword: string) {
  try { await requireWorker(["admin"]); } catch { return { errors: { password: "Unauthorized" } }; }
  const parsed = resetPasswordSchema.safeParse({ targetId: workerId, newPassword });
  if (!parsed.success) return { errors: { password: Object.values(zodErrors(parsed.error))[0] } };

  const worker = await prisma.worker.findUnique({ where: { id: workerId } });
  if (!worker) return { errors: { password: "Worker not found" } };

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.worker.update({
    where: { id: workerId },
    data: { password: hashed },
  });

  await prisma.auditLog.create({
    data: {
      action: "password_reset",
      status: "success",
      details: JSON.stringify({ workerId, type: "worker" }),
      actorType: "worker",
    },
  });

  return { success: true };
}

export async function changeSelfPassword(
  currentPassword: string,
  newPassword: string
) {
  let session;
  try { session = await requireAuth(); } catch { return { errors: { currentPassword: "Unauthorized" } }; }

  const parsed = changeSelfPasswordSchema.safeParse({ currentPassword, newPassword });
  if (!parsed.success) return { errors: zodErrors(parsed.error) };

  const actorType = session.user.actorType;
  const actorId = parseInt(session.user.id);

  if (actorType === "member") {
    const user = await prisma.user.findUnique({ where: { id: actorId } });
    if (!user) return { errors: { currentPassword: "User not found" } };

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return { errors: { currentPassword: "Current password is incorrect" } };

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: actorId },
      data: { password: hashed },
    });
  } else if (actorType === "worker") {
    const worker = await prisma.worker.findUnique({ where: { id: actorId } });
    if (!worker) return { errors: { currentPassword: "Worker not found" } };

    const valid = await bcrypt.compare(currentPassword, worker.password);
    if (!valid) return { errors: { currentPassword: "Current password is incorrect" } };

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.worker.update({
      where: { id: actorId },
      data: { password: hashed },
    });
  } else {
    return { errors: { currentPassword: "Invalid actor type" } };
  }

  return { success: true };
}
