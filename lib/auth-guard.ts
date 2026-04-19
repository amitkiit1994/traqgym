import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAiContext } from "@/lib/ai-context";
import { prisma } from "@/lib/prisma";

export async function requireWorker(roles?: string[]) {
  // Check AI agent context first (already authenticated at the API route level)
  const aiCtx = getAiContext();
  if (aiCtx) {
    if (roles && !roles.includes(aiCtx.role)) {
      throw new Error("Insufficient permissions");
    }
    return {
      user: {
        id: String(aiCtx.workerId),
        actorType: "worker" as const,
        role: aiCtx.role,
        name: "AI Agent",
        locationId: null,
      },
    } as Awaited<ReturnType<typeof getServerSession>> & { user: { id: string; actorType: "worker"; role: string; name: string; locationId: number | null } };
  }

  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    throw new Error("Unauthorized");
  }
  if (roles && !roles.includes(session.user.role)) {
    throw new Error("Insufficient permissions");
  }
  return session;
}

export async function requireMember() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "member") {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function requireAuth() {
  const session = await getServerSession(authOptions);
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

/**
 * Require the current session to be a Worker who is assigned as `trainerId` on
 * at least one PtPackage. Returns minimal trainer identity for use in pages.
 *
 * Throws "Unauthorized" if no worker session, or "Not a trainer" if the worker
 * has no PT packages assigned to them.
 */
export async function requireTrainer(): Promise<{ workerId: number; name: string }> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    throw new Error("Unauthorized");
  }
  const workerId = parseInt(session.user.id, 10);
  if (!Number.isFinite(workerId)) {
    throw new Error("Unauthorized");
  }

  // PR 15 audit fix (HIGH): only treat the caller as a trainer if they
  // currently have at least one *active* PT package assigned. Without the
  // status filter, a former trainer whose packages were all reassigned (or
  // marked completed/cancelled) retained access to ex-clients' body
  // measurements + session history via /trainer/clients/[id].
  const hasPackage = await prisma.ptPackage.findFirst({
    where: { trainerId: workerId, status: "active" },
    select: { id: true },
  });
  if (!hasPackage) {
    throw new Error("Not a trainer");
  }

  return { workerId, name: session.user.name ?? "Trainer" };
}
