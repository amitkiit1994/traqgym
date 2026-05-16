import Link from "next/link";
import { ArrowLeft, KeyRound, Shield } from "lucide-react";
import { GymBrand } from "@/components/gym-brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { ForgotPasswordForm } from "./form";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex bg-background relative overflow-hidden">
      {/* keep the existing visual structure — orbs, ThemeToggle, etc */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-primary/5 dark:bg-primary/10 blur-[100px] animate-[pulse_8s_ease-in-out_infinite]" />
        <div className="absolute bottom-[-10%] left-[30%] w-[400px] h-[400px] rounded-full bg-[oklch(0.55_0.18_295_/_0.03)] dark:bg-[oklch(0.55_0.18_295_/_0.06)] blur-[80px] animate-[pulse_12s_ease-in-out_infinite_2s]" />
      </div>
      <div className="absolute top-5 right-5 z-10">
        <ThemeToggle />
      </div>
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="w-full max-w-[460px]">
          <div className="flex justify-center mb-8">
            <GymBrand size="md" className="text-primary" />
          </div>
          <div className="relative">
            <div className="absolute -inset-1 rounded-3xl bg-gradient-to-br from-primary/10 via-transparent to-[oklch(0.65_0.15_230_/_0.06)] blur-xl opacity-60 dark:opacity-40" />
            <div className="relative bg-card/70 dark:bg-card/50 backdrop-blur-2xl backdrop-saturate-[1.5] rounded-2xl shadow-[0_8px_40px_oklch(0.565_0.20_275_/_6%),0_0_0_1px_oklch(0.565_0.20_275_/_8%)] dark:shadow-[0_8px_40px_oklch(0_0_0_/_20%),0_0_0_1px_oklch(0.68_0.17_275_/_10%)] overflow-hidden">
              <div className="h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
              <div className="p-5 sm:p-8 md:p-10">
                <div className="mb-6">
                  <div className="inline-flex items-center justify-center size-12 rounded-2xl bg-primary/10 border border-primary/10 mb-4">
                    <KeyRound className="size-6 text-primary" />
                  </div>
                  <h2 className="text-2xl font-bold tracking-tight">Forgot your password?</h2>
                  <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
                    Enter your email or phone number. We&apos;ll send a reset link valid for 15 minutes.
                  </p>
                </div>
                <ForgotPasswordForm />
                <div className="mt-6">
                  <Link
                    href="/login"
                    className="group inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                  >
                    <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
                    Back to sign in
                  </Link>
                </div>
              </div>
              <div className="px-5 sm:px-8 md:px-10 py-4 border-t border-border/30 bg-muted/20 dark:bg-white/[0.02]">
                <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/60">
                  <Shield className="size-3" />
                  Powered by{" "}
                  <span className="font-medium text-muted-foreground/80">TraqGym</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
