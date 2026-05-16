"use server";

import { prisma } from "@/lib/prisma";
import { sendEmail, normalizePhone } from "@/lib/services/notification";

export type SignupResult =
  | { success: true; id: number }
  | { success: false; error: string };

export async function requestGymSignup(input: {
  gymName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  subdomain?: string;
  city?: string;
  notes?: string;
}): Promise<SignupResult> {
  // Validate
  const gymName = input.gymName?.trim();
  const ownerName = input.ownerName?.trim();
  const ownerEmail = input.ownerEmail?.trim().toLowerCase();
  const ownerPhone = normalizePhone(input.ownerPhone ?? "");
  if (!gymName || !ownerName || !ownerEmail || !ownerPhone) {
    return { success: false, error: "Please fill all required fields." };
  }
  if (!ownerEmail.includes("@")) {
    return { success: false, error: "Please enter a valid email." };
  }

  // Rate limit by IP (5/hour per IP to deter spam)
  // Note: this runs in server action context, no Request — skip IP-based limit
  // and rely on email-based de-dup instead
  const existing = await prisma.pendingGymProvisioning.findFirst({
    where: { ownerEmail, status: "pending" },
  });
  if (existing) {
    return {
      success: false,
      error: "We already have a pending signup for that email. We'll be in touch shortly.",
    };
  }

  const row = await prisma.pendingGymProvisioning.create({
    data: {
      gymName,
      ownerName,
      ownerEmail,
      ownerPhone,
      subdomain: input.subdomain?.trim() || null,
      city: input.city?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  });

  // Notify ops via email (uses notification service from Phase 5)
  const opsEmail = process.env.OPS_NOTIFY_EMAIL ?? "hello@traqgym.com";
  await sendEmail({
    to: opsEmail,
    subject: `New gym signup: ${gymName}`,
    body: `New gym signup request:\n\nGym: ${gymName}\nOwner: ${ownerName}\nEmail: ${ownerEmail}\nPhone: ${ownerPhone}\nSubdomain: ${input.subdomain ?? "(suggest one)"}\nCity: ${input.city ?? "-"}\nNotes: ${input.notes ?? "-"}\n\nProvision via: ./scripts/onboard-gym.sh "${gymName}" <subdomain> ${ownerEmail}\nPending row id: ${row.id}`,
  });

  return { success: true, id: row.id };
}
