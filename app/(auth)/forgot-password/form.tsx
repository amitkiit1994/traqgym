"use client";

import { useState, useTransition } from "react";
import { requestPasswordReset } from "@/lib/actions/password-reset";

export function ForgotPasswordForm() {
  const [id, setId] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pending, start] = useTransition();

  if (submitted) {
    return (
      <div className="rounded-xl border border-green-500/40 bg-green-50 dark:bg-green-950/30 p-4 text-sm">
        <p className="font-medium">Check your email or phone.</p>
        <p className="text-muted-foreground mt-1">
          If an account exists for that contact, we&apos;ve sent a reset link. The link expires in 15 minutes.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await requestPasswordReset({ emailOrPhone: id });
          setSubmitted(true);
        });
      }}
      className="space-y-3"
    >
      <input
        type="text"
        required
        autoComplete="email tel"
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="Email or 10-digit phone"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={!id || pending}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
