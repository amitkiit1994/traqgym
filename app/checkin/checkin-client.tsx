"use client";

import { useState, useTransition } from "react";

type MemberSession = { id: number; name: string };

export function CheckinClient({
  token,
  locationId,
  locationName,
  gymName,
  memberSession,
}: {
  token: string;
  locationId: number;
  locationName: string;
  gymName: string;
  memberSession: MemberSession | null;
}) {
  const [phone, setPhone] = useState("");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { ok: true; userName: string; alreadyCheckedIn?: boolean }
    | { ok: false; error: string }
    | null
  >(null);

  const submit = (mode: "session" | "phone") => {
    setResult(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/checkin/qr/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            mode,
            phone: mode === "phone" ? phone.trim() : undefined,
          }),
        });
        const data = await res.json();
        if (data.success) {
          setResult({
            ok: true,
            userName: data.userName,
            alreadyCheckedIn: data.alreadyCheckedIn,
          });
        } else {
          setResult({ ok: false, error: data.error ?? "Check-in failed" });
        }
      } catch {
        setResult({ ok: false, error: "Network error. Please try again." });
      }
    });
  };

  return (
    <main className="min-h-dvh flex items-center justify-center p-4 bg-background text-foreground">
      <div className="max-w-md w-full rounded-2xl border border-border bg-card p-6 md:p-8 shadow-lg space-y-6">
        <div className="text-center space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{gymName}</p>
          <h1 className="text-2xl font-semibold">Check in at {locationName}</h1>
        </div>

        {result?.ok ? (
          <div className="rounded-xl border border-status-active/30 bg-status-active/5 p-6 text-center">
            <p className="text-3xl mb-2" aria-hidden>✓</p>
            <p className="text-lg font-semibold">
              {result.alreadyCheckedIn ? "Already checked in today" : "Welcome!"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">{result.userName}</p>
          </div>
        ) : (
          <>
            {memberSession ? (
              <div className="space-y-3">
                <p className="text-sm">
                  Signed in as <span className="font-medium">{memberSession.name}</span>
                </p>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => submit("session")}
                  className="w-full rounded-lg bg-primary text-primary-foreground py-3 text-base font-semibold disabled:opacity-50"
                >
                  {isPending ? "Checking in..." : "Check in"}
                </button>
                <p className="text-xs text-center text-muted-foreground">
                  Not you? <a href="/login" className="underline">Sign in as someone else</a>
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-sm font-medium" htmlFor="phone">
                  Enter your phone number
                </label>
                <input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="9876543210"
                  className="w-full rounded-lg border border-input bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  disabled={isPending || phone.trim().length < 7}
                  onClick={() => submit("phone")}
                  className="w-full rounded-lg bg-primary text-primary-foreground py-3 text-base font-semibold disabled:opacity-50"
                >
                  {isPending ? "Checking in..." : "Check in"}
                </button>
                <p className="text-xs text-center text-muted-foreground">
                  Or <a href={`/login?callbackUrl=/checkin?token=${encodeURIComponent(token)}`} className="underline">sign in</a> first
                </p>
              </div>
            )}

            {result && !result.ok && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive text-center">
                {result.error}
              </div>
            )}
          </>
        )}

        <p className="text-[10px] text-center text-muted-foreground">
          Location ID: {locationId}
        </p>
      </div>
    </main>
  );
}
