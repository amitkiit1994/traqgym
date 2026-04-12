import { prisma } from "@/lib/prisma";

export async function createTemplate(data: {
  name: string;
  content: string;
  required?: boolean;
}) {
  try {
    const template = await prisma.waiverTemplate.create({
      data: {
        name: data.name.trim(),
        content: data.content.trim(),
        required: data.required ?? true,
      },
    });

    return {
      success: true,
      template: {
        id: template.id,
        name: template.name,
        required: template.required,
        isActive: template.isActive,
        createdAt: template.createdAt.toISOString(),
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create template" };
  }
}

export async function getTemplates(activeOnly?: boolean) {
  try {
    const where: Record<string, unknown> = {};
    if (activeOnly) where.isActive = true;

    const templates = await prisma.waiverTemplate.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      content: t.content,
      required: t.required,
      isActive: t.isActive,
      createdAt: t.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function signWaiver(data: {
  userId: number;
  templateId: number;
  ipAddress?: string;
  signature?: string;
}) {
  try {
    const signature = await prisma.waiverSignature.create({
      data: {
        userId: data.userId,
        templateId: data.templateId,
        ipAddress: data.ipAddress ?? null,
        signature: data.signature ?? null,
      },
    });

    return {
      success: true,
      signature: {
        id: signature.id,
        userId: signature.userId,
        templateId: signature.templateId,
        signedAt: signature.signedAt.toISOString(),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to sign waiver";
    if (msg.includes("Unique constraint")) {
      return { success: false, error: "User has already signed this waiver" };
    }
    return { success: false, error: msg };
  }
}

export async function getWaiverStatus(userId: number) {
  try {
    const templates = await prisma.waiverTemplate.findMany({
      where: { isActive: true },
      include: {
        signatures: {
          where: { userId },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return templates.map((t) => ({
      templateId: t.id,
      templateName: t.name,
      required: t.required,
      signed: t.signatures.length > 0,
      signedAt: t.signatures[0]?.signedAt?.toISOString() ?? null,
    }));
  } catch {
    return [];
  }
}

export async function getUnsignedWaivers(userId: number) {
  try {
    const signed = await prisma.waiverSignature.findMany({
      where: { userId },
      select: { templateId: true },
    });
    const signedIds = signed.map((s) => s.templateId);

    const unsigned = await prisma.waiverTemplate.findMany({
      where: {
        isActive: true,
        id: { notIn: signedIds.length > 0 ? signedIds : [-1] },
      },
      orderBy: { createdAt: "asc" },
    });

    return unsigned.map((t) => ({
      id: t.id,
      name: t.name,
      required: t.required,
    }));
  } catch {
    return [];
  }
}
