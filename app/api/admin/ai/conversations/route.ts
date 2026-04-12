import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET - list conversations
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workerId = Number(session.user.id);
  const conversations = await prisma.aiConversation.findMany({
    where: { workerId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
    take: 50,
  });

  return NextResponse.json(conversations);
}
