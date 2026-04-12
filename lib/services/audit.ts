import { prisma } from "@/lib/prisma";

export async function log(params: {
  action: string;
  status: string;
  details?: string;
  actorId?: number;
  actorType?: string;
}) {
  return prisma.auditLog.create({
    data: {
      action: params.action,
      status: params.status,
      details: params.details ?? null,
      actorId: params.actorId ?? null,
      actorType: params.actorType ?? null,
    },
  });
}
