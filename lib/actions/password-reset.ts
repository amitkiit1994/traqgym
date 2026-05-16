"use server";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { sendEmail, sendSMS, normalizePhone } from "@/lib/services/notification";
import { rateLimit } from "@/lib/services/ratelimit";

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 min
const TOKEN_LENGTH_BYTES = 24;

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function requestPasswordReset(params: {
  emailOrPhone: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const id = params.emailOrPhone.trim().toLowerCase();
  if (!id) return { success: false, error: "Please enter an email or phone number." };

  // Rate limit per identifier: 5 requests per hour. When over the limit we
  // STILL return success (never leak that the throttle exists or that the
  // account exists — same response shape as the not-found path). The only
  // change is that we don't actually generate a token / send a message.
  // This prevents abuse (SMS bombing, mailbox bombing, token DB inflation)
  // while preserving the existing email-enumeration protection.
  const rl = rateLimit({
    key: "pwd-reset:" + id,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!rl.ok) {
    return { success: true };
  }

  // Find the user/worker — we deliberately do NOT reveal whether the account exists.
  // (Email enumeration protection.)
  const isEmail = id.includes("@");
  const phone = isEmail ? null : normalizePhone(id);

  let email = "";
  let target: { id: number; email?: string | null; phone?: string | null } | null = null;

  if (isEmail) {
    const user = await prisma.user.findFirst({
      where: { email: id },
      select: { id: true, email: true, phone: true },
    });
    // Worker has no `phone` column — fetch only id/email
    const worker = user
      ? null
      : await prisma.worker.findFirst({
          where: { email: id },
          select: { id: true, email: true },
        });
    target = user ?? (worker ? { ...worker, phone: null } : null);
    email = id;
  } else if (phone) {
    const user = await prisma.user.findFirst({
      where: { phone: phone },
      select: { id: true, email: true, phone: true },
    });
    target = user ?? null;
    email = user?.email ?? "";
  }

  // Generate token even if account doesn't exist — same timing, no enumeration leak.
  const rawToken = crypto.randomBytes(TOKEN_LENGTH_BYTES).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  if (target && email) {
    await prisma.passwordResetToken.create({
      data: { email, tokenHash, expiresAt },
    });

    const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "";
    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

    if (isEmail) {
      await sendEmail({
        to: email,
        subject: "Reset your TraqGym password",
        body: `Click to reset your password (valid for 15 minutes): ${resetUrl}\n\nIf you didn't request this, ignore this email.`,
        html: `<p>Click to reset your password (valid for 15 minutes):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, ignore this email.</p>`,
      });
    } else if (phone && target.phone) {
      // SMS — short URL form. MSG91 templates are typically pre-approved; we send the raw URL.
      await sendSMS({ to: phone, message: `Reset link (valid 15 min): ${resetUrl}` });
    }
  }

  // Always return success — never leak whether account exists
  return { success: true };
}

export async function verifyResetToken(
  token: string,
): Promise<{ valid: true; email: string } | { valid: false }> {
  if (!token) return { valid: false };
  const tokenHash = hashToken(token);
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!row) return { valid: false };
  if (row.usedAt) return { valid: false };
  if (row.expiresAt < new Date()) return { valid: false };
  return { valid: true, email: row.email };
}

export async function resetPassword(params: {
  token: string;
  newPassword: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  if (params.newPassword.length < 8) {
    return { success: false, error: "Password must be at least 8 characters." };
  }
  const verification = await verifyResetToken(params.token);
  if (!verification.valid) {
    return { success: false, error: "Invalid or expired token. Request a new password reset." };
  }
  const tokenHash = hashToken(params.token);
  const hashed = await bcrypt.hash(params.newPassword, 10);

  // Update the matching user OR worker, mark token used (transaction)
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.update({
      where: { tokenHash },
      data: { usedAt: new Date() },
    });
    const userUpdate = await tx.user.updateMany({
      where: { email: verification.email },
      data: { password: hashed },
    });
    if (userUpdate.count === 0) {
      await tx.worker.updateMany({
        where: { email: verification.email },
        data: { password: hashed },
      });
    }
  });
  return { success: true };
}
