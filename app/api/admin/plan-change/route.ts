import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { upgradePlan } from "@/lib/services/plan-change";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).actorType !== "worker") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { userId, currentTicketId, newPlanId, locationId, paymentMode, upiRef } = body;

  if (!userId || !currentTicketId || !newPlanId || !locationId || !paymentMode) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const result = await upgradePlan({
    userId,
    currentTicketId,
    newPlanId,
    locationId,
    paymentMode,
    upiRef,
    collectedById: parseInt(String((session.user as any).id), 10),
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
