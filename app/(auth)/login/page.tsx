"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { GymBrand } from "@/components/gym-brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Dumbbell, Lock, Mail, ArrowRight, Shield } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setLoading(false);
      return;
    }

    // Fetch session to determine redirect
    const res = await fetch("/api/auth/session");
    const session = await res.json();

    if (session?.user?.actorType === "worker") {
      router.push("/admin/dashboard");
    } else {
      router.push("/member");
    }
  }

  return (
    <div className="min-h-screen flex bg-background relative overflow-hidden">
      {/* ── Animated background orbs ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-primary/5 dark:bg-primary/10 blur-[100px] animate-[pulse_8s_ease-in-out_infinite]" />
        <div className="absolute top-[20%] right-[-15%] w-[500px] h-[500px] rounded-full bg-[oklch(0.65_0.15_45_/_0.04)] dark:bg-[oklch(0.65_0.15_45_/_0.08)] blur-[100px] animate-[pulse_10s_ease-in-out_infinite_1s]" />
        <div className="absolute bottom-[-10%] left-[30%] w-[400px] h-[400px] rounded-full bg-[oklch(0.55_0.18_15_/_0.03)] dark:bg-[oklch(0.55_0.18_15_/_0.06)] blur-[80px] animate-[pulse_12s_ease-in-out_infinite_2s]" />
      </div>

      {/* ── Subtle grid pattern ── */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.015] dark:opacity-[0.03]"
        style={{
          backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
          backgroundSize: "32px 32px",
        }}
      />

      {/* ── Theme toggle ── */}
      <div className="absolute top-5 right-5 z-10">
        <ThemeToggle />
      </div>

      {/* ── Left panel — gym branding (hidden on mobile) ── */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-[40%] flex-col justify-between p-12 relative">
        <div>
          <GymBrand size="lg" className="text-primary" />
        </div>

        <div className="space-y-8">
          <div>
            <h1 className="text-4xl xl:text-5xl font-bold tracking-tight leading-[1.1]">
              <span className="gradient-text">Your fitness</span>
              <br />
              <span className="text-foreground">journey starts here.</span>
            </h1>
            <p className="mt-4 text-muted-foreground text-lg max-w-md leading-relaxed">
              Track progress, manage memberships, and stay on top of your fitness goals.
            </p>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2">
            {["Memberships", "Attendance", "Payments", "Member Portal"].map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-primary/8 text-primary border border-primary/10 backdrop-blur-sm"
              >
                <span className="size-1.5 rounded-full bg-primary/60" />
                {f}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
          <Shield className="size-3.5" />
          <span>Powered by TraqGym</span>
        </div>
      </div>

      {/* ── Right panel — login form ── */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="w-full max-w-[420px]">
          {/* Mobile brand */}
          <div className="flex justify-center mb-8 lg:hidden">
            <GymBrand size="md" className="text-primary" />
          </div>

          {/* Login card */}
          <div className="relative">
            {/* Card glow */}
            <div className="absolute -inset-1 rounded-3xl bg-gradient-to-br from-primary/10 via-transparent to-[oklch(0.65_0.15_45_/_0.06)] blur-xl opacity-60 dark:opacity-40" />

            <div className="relative bg-card/70 dark:bg-card/50 backdrop-blur-2xl backdrop-saturate-[1.5] rounded-2xl shadow-[0_8px_40px_oklch(0.565_0.20_25_/_6%),0_0_0_1px_oklch(0.565_0.20_25_/_8%)] dark:shadow-[0_8px_40px_oklch(0_0_0_/_20%),0_0_0_1px_oklch(0.68_0.17_25_/_10%)] overflow-hidden">
              {/* Top gradient accent */}
              <div className="h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

              <div className="p-5 sm:p-8 md:p-10">
                {/* Header */}
                <div className="mb-8">
                  <div className="inline-flex items-center justify-center size-12 rounded-2xl bg-primary/10 border border-primary/10 mb-4">
                    <Dumbbell className="size-6 text-primary" />
                  </div>
                  <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
                  <p className="text-muted-foreground text-sm mt-1">
                    Sign in to continue to your dashboard
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Email field */}
                  <div className="space-y-1.5">
                    <label htmlFor="email" className="block text-sm font-medium text-foreground/80">
                      Email address
                    </label>
                    <div className={`relative group transition-all duration-200 ${focused === "email" ? "scale-[1.01]" : ""}`}>
                      <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                        <Mail className={`size-4 transition-colors duration-200 ${focused === "email" ? "text-primary" : "text-muted-foreground/50"}`} />
                      </div>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        required
                        onFocus={() => setFocused("email")}
                        onBlur={() => setFocused(null)}
                        className="w-full pl-10 pr-4 py-2.5 bg-background/50 dark:bg-white/[0.04] border border-border/60 rounded-xl text-sm transition-all duration-200 outline-none placeholder:text-muted-foreground/40 focus:border-primary/40 focus:ring-2 focus:ring-primary/20 focus:bg-background/80 dark:focus:bg-white/[0.06] hover:border-border"
                        placeholder="you@example.com"
                      />
                    </div>
                  </div>

                  {/* Password field */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="password" className="block text-sm font-medium text-foreground/80">
                        Password
                      </label>
                      <Link
                        href="/forgot-password"
                        className="text-xs font-medium text-primary/90 hover:text-primary hover:underline"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <div className={`relative group transition-all duration-200 ${focused === "password" ? "scale-[1.01]" : ""}`}>
                      <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                        <Lock className={`size-4 transition-colors duration-200 ${focused === "password" ? "text-primary" : "text-muted-foreground/50"}`} />
                      </div>
                      <input
                        id="password"
                        name="password"
                        type="password"
                        required
                        onFocus={() => setFocused("password")}
                        onBlur={() => setFocused(null)}
                        className="w-full pl-10 pr-4 py-2.5 bg-background/50 dark:bg-white/[0.04] border border-border/60 rounded-xl text-sm transition-all duration-200 outline-none placeholder:text-muted-foreground/40 focus:border-primary/40 focus:ring-2 focus:ring-primary/20 focus:bg-background/80 dark:focus:bg-white/[0.06] hover:border-border"
                        placeholder="Enter your password"
                      />
                    </div>
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/8 border border-destructive/15 text-destructive text-sm">
                      <div className="size-1.5 rounded-full bg-destructive animate-pulse" />
                      {error}
                    </div>
                  )}

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="group relative w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary text-primary-foreground rounded-xl font-medium text-sm disabled:opacity-50 transition-all duration-200 shadow-[0_4px_16px_oklch(0.565_0.20_25_/_25%)] hover:shadow-[0_6px_24px_oklch(0.565_0.20_25_/_35%)] hover:brightness-110 hover:scale-[1.01] active:scale-[0.99]"
                  >
                    {loading ? (
                      <>
                        <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Signing in...
                      </>
                    ) : (
                      <>
                        Sign in
                        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                      </>
                    )}
                  </button>
                </form>

                {/* New gym CTA */}
                <p className="mt-6 text-center text-sm text-muted-foreground">
                  New gym?{" "}
                  <Link href="/signup" className="font-medium text-primary hover:underline">
                    Sign up here
                  </Link>
                </p>
              </div>

              {/* Bottom bar */}
              <div className="px-5 sm:px-8 md:px-10 py-4 border-t border-border/30 bg-muted/20 dark:bg-white/[0.02]">
                <p className="text-center text-xs text-muted-foreground/60">
                  Powered by <span className="font-medium text-muted-foreground/80">TraqGym</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
