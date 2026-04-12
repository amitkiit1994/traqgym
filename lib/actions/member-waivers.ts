"use server";

import { prisma } from "@/lib/prisma";
import { requireMember } from "@/lib/auth-guard";

export async function getMemberWaiverStatus() {
  const session = await requireMember();
  const userId = parseInt(session.user.id);

  const templates = await prisma.waiverTemplate.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });

  const signatures = await prisma.waiverSignature.findMany({
    where: { userId },
  });

  const signedMap = new Map(
    signatures.map((s) => [s.templateId, s.signedAt])
  );

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    content: t.content,
    required: t.required,
    signed: signedMap.has(t.id),
    signedAt: signedMap.get(t.id)?.toISOString() ?? null,
  }));
}

export async function signMemberWaiver(templateId: number) {
  const session = await requireMember();
  const userId = parseInt(session.user.id);

  const template = await prisma.waiverTemplate.findUnique({
    where: { id: templateId, isActive: true },
  });
  if (!template) {
    return { success: false, error: "Waiver template not found" };
  }

  const existing = await prisma.waiverSignature.findUnique({
    where: { userId_templateId: { userId, templateId } },
  });
  if (existing) {
    return { success: false, error: "Already signed" };
  }

  await prisma.waiverSignature.create({
    data: { userId, templateId },
  });

  return { success: true };
}
