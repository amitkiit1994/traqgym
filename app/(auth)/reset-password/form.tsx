"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetPassword } from "@/lib/actions/password-reset";

export function ResetForm({ token }: { token: string }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        if (pw !== pw2) {
          setErr("Passwords don't match");
          return;
        }
        start(async () => {
          const res = await resetPassword({ token, newPassword: pw });
          if (res.success) {
            router.push("/login?reset=ok");
          } else {
            setErr(res.error);
          }
        });
      }}
      className="space-y-3"
    >
      <input
        type="password"
        required
        minLength={8}
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="New password (min 8 chars)"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
      <input
        type="password"
        required
        minLength={8}
        value={pw2}
        onChange={(e) => setPw2(e.target.value)}
        placeholder="Confirm new password"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {pending ? "Updating…" : "Set new password"}
      </button>
    </form>
  );
}
