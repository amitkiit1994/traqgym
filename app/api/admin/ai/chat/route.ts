import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { run } from "@openai/agents";
import type { AgentInputItem } from "@openai/agents";
import { createGymAgent } from "@/lib/ai/agent";
import type { AgentContext } from "@/lib/ai/system-prompt";
import { runInAiContext } from "@/lib/ai-context";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { message, conversationId } = await req.json();
  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  // Check API key
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OpenAI API key not configured. Add OPENAI_API_KEY to your environment." },
      { status: 500 },
    );
  }

  const workerId = Number(session.user.id);
  const role = session.user.role;

  // Rate limiting
  const monthKey = new Date().toISOString().slice(0, 7); // "2026-04"
  const limitStr = await prisma.gymSettings.findUnique({ where: { key: "ai_monthly_query_limit" } });
  const limit = parseInt(limitStr?.value || "500", 10);

  const usage = await prisma.aiUsage.upsert({
    where: { workerId_month: { workerId, month: monthKey } },
    create: { workerId, month: monthKey, queryCount: 1 },
    update: { queryCount: { increment: 1 } },
  });

  if (usage.queryCount > limit) {
    return NextResponse.json(
      { error: `Monthly AI query limit reached (${limit}). Contact admin to increase.` },
      { status: 429 },
    );
  }

  // Load or create conversation
  let convoId = conversationId ? Number(conversationId) : null;
  if (convoId) {
    const existing = await prisma.aiConversation.findFirst({
      where: { id: convoId, workerId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
  } else {
    const convo = await prisma.aiConversation.create({
      data: { workerId, title: message.slice(0, 100) },
    });
    convoId = convo.id;
  }

  // Save user message
  await prisma.aiMessage.create({
    data: { conversationId: convoId, role: "user", content: message },
  });

  // Build conversation history for the agent
  const history = await prisma.aiMessage.findMany({
    where: { conversationId: convoId },
    orderBy: { createdAt: "asc" },
  });

  // Convert DB messages to agent input items
  const inputItems: AgentInputItem[] = history.map((m) => {
    if (m.role === "user") {
      return { role: "user" as const, content: m.content };
    }
    return {
      role: "assistant" as const,
      status: "completed" as const,
      content: [{ type: "output_text" as const, text: m.content }],
    };
  });

  // Get location info
  const location = session.user.locationId
    ? await prisma.location.findUnique({ where: { id: session.user.locationId } })
    : await prisma.location.findFirst({ where: { isActive: true } });

  const gymName =
    process.env.NEXT_PUBLIC_GYM_NAME || process.env.GYM_NAME || "TraqGym";

  const context: AgentContext = {
    gymName,
    locationName: location?.name || gymName,
    locationId: location?.id ?? null,
    workerName: session.user.name || "Staff",
    role,
    workerId,
  };

  const agent = createGymAgent(context);

  // Stream the response
  const aiCtx = { workerId, role };
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      await runInAiContext(aiCtx, async () => {
        try {
          const result = await run(agent, inputItems, { stream: true });
          let fullResponse = "";

          // Send conversation ID first
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "conversation_id", id: convoId })}\n\n`),
          );

          // Stream events from the agent
          for await (const event of result) {
            if (event.type === "raw_model_stream_event") {
              const data = event.data as Record<string, unknown>;
              if (data.type === "output_text_delta") {
                const delta = (data as { delta?: string }).delta || "";
                fullResponse += delta;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "text", content: delta })}\n\n`),
                );
              }
            }
          }

          // Save assistant response
          await prisma.aiMessage.create({
            data: {
              conversationId: convoId!,
              role: "assistant",
              content: fullResponse,
            },
          });

          // Update conversation title if it was the first exchange
          if (history.length <= 1) {
            await prisma.aiConversation.update({
              where: { id: convoId! },
              data: { title: message.slice(0, 100) },
            });
          }

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`),
          );
          controller.close();
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : "An error occurred";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`,
            ),
          );
          controller.close();
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
