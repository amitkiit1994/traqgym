import Link from "next/link";
import { ArrowLeft, Rocket } from "lucide-react";
import { GymBrand } from "@/components/gym-brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignupForm } from "./form";

export const metadata = { title: "Sign up your gym" };
export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <div className="min-h-screen flex bg-background relative overflow-hidden">
      <div className="absolute top-5 right-5 z-10">
        <ThemeToggle />
      </div>
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="w-full max-w-[520px]">
          <div className="flex justify-center mb-8">
            <GymBrand size="md" />
          </div>
          <div className="rounded-2xl border bg-card/70 p-8 backdrop-blur-2xl">
            <div className="mb-6">
              <div className="inline-flex items-center justify-center size-12 rounded-2xl bg-primary/10 mb-4">
                <Rocket className="size-6 text-primary" />
              </div>
              <h2 className="text-2xl font-bold">Bring your gym to TraqGym</h2>
              <p className="text-muted-foreground text-sm mt-2">
                Tell us about your gym. We&apos;ll set up your instance and email you login
                details — usually within 24 hours. Free for the first 30 days.
              </p>
            </div>
            <SignupForm />
            <div className="mt-6 text-sm">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-primary hover:underline"
              >
                <ArrowLeft className="size-4" /> Already have a TraqGym account? Log in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
