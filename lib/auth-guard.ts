import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAiContext } from "@/lib/ai-context";

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
      },
    } as Awaited<ReturnType<typeof getServerSession>> & { user: { id: string; actorType: "worker"; role: string; name: string } };
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
