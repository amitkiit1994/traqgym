import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkOrigin } from "@/lib/services/csrf";

// GET - load conversation with messages
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const workerId = Number(session.user.id);
  const conversation = await prisma.aiConversation.findFirst({
    where: { id: Number(id), workerId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(conversation);
}

// DELETE - delete conversation
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrf = checkOrigin(req);
  if (!csrf.ok) return Response.json({ error: csrf.error }, { status: 403 });

  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const workerId = Number(session.user.id);
  const conversation = await prisma.aiConversation.findFirst({
    where: { id: Number(id), workerId },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.aiConversation.delete({ where: { id: Number(id) } });

  return NextResponse.json({ success: true });
}
