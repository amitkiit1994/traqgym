import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { checkOrigin } from "@/lib/services/csrf";

export async function POST(req: NextRequest) {
  const csrf = checkOrigin(req);
  if (!csrf.ok) return Response.json({ error: csrf.error }, { status: 403 });

  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { type, id } = await req.json();
  if (!type || !id) {
    return NextResponse.json({ error: "type and id are required" }, { status: 400 });
  }

  let prompt = "";

  if (type === "enquiry") {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: Number(id) },
      include: {
        followups: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { notes: true, createdAt: true, outcome: true },
        },
      },
    });

    if (!enquiry) {
      return NextResponse.json({ error: "Enquiry not found" }, { status: 404 });
    }

    const followupHistory = enquiry.followups
      .map((f) => `- ${f.createdAt.toISOString().split("T")[0]}: ${f.outcome ?? "no outcome"} — ${f.notes ?? "no notes"}`)
      .join("\n");

    prompt = `Draft a WhatsApp follow-up message for this gym enquiry:

Name: ${enquiry.name}
Phone: ${enquiry.phone}
Source: ${enquiry.source}
Interest: ${enquiry.interest ?? "General"}
Stage: ${enquiry.stage}
Notes: ${enquiry.notes ?? "None"}

Previous follow-ups:
${followupHistory || "None yet"}

Write a short, warm, personalized WhatsApp message (2-3 sentences). Be friendly, not pushy. End with a clear call to action. Return ONLY the message text.`;
  } else if (type === "payment") {
    const followup = await prisma.paymentFollowup.findUnique({
      where: { id: Number(id) },
      include: {
        user: { select: { firstname: true, lastname: true, phone: true } },
      },
    });

    if (!followup) {
      return NextResponse.json({ error: "Payment follow-up not found" }, { status: 404 });
    }

    prompt = `Draft a WhatsApp follow-up message for an outstanding gym payment:

Member: ${followup.user.firstname} ${followup.user.lastname}
Amount Due: ₹${Number(followup.amountDue).toLocaleString("en-IN")}
Due Date: ${followup.dueDate.toISOString().split("T")[0]}
Priority: ${followup.priority}
Notes: ${followup.notes ?? "None"}
Last Contacted: ${followup.lastContactedAt?.toISOString().split("T")[0] ?? "Never"}

Write a polite, empathetic WhatsApp message (2-3 sentences) reminding about the pending payment. Be respectful — this is a gym member, not a debtor. End with a helpful offer. Return ONLY the message text.`;
  } else {
    return NextResponse.json({ error: "Invalid type. Use 'enquiry' or 'payment'" }, { status: 400 });
  }

  const { output } = await runProactiveAgent({
    feature: "draft_followup",
    prompt,
  });

  return NextResponse.json({ draft: output });
}
