import { verifyResetToken } from "@/lib/actions/password-reset";
import { GymBrand } from "@/components/gym-brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { ResetForm } from "./form";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const verification = token ? await verifyResetToken(token) : { valid: false as const };

  return (
    <div className="min-h-screen flex bg-background relative overflow-hidden">
      <div className="absolute top-5 right-5 z-10">
        <ThemeToggle />
      </div>
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="w-full max-w-[460px]">
          <div className="flex justify-center mb-8">
            <GymBrand size="md" className="text-primary" />
          </div>
          <div className="rounded-2xl border bg-card/70 p-8 backdrop-blur-2xl">
            {verification.valid ? (
              <>
                <h2 className="text-2xl font-bold mb-2">Set a new password</h2>
                <p className="text-muted-foreground text-sm mb-4">For {verification.email}</p>
                <ResetForm token={token!} />
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold mb-2">Link invalid or expired</h2>
                <p className="text-muted-foreground text-sm mb-4">
                  Reset links are valid for 15 minutes and can only be used once.
                </p>
                <Link href="/forgot-password" className="text-primary underline text-sm">
                  Request a new link
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
