import Link from "next/link";
import Image from "next/image";
import { Compass, Home, LogIn, Shield } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSetting } from "@/lib/services/settings";

export const metadata = {
  title: "Page not found",
};

export default async function NotFound() {
  const [gymName, gymLogo] = await Promise.all([
    getSetting("gym_name", process.env.NEXT_PUBLIC_GYM_NAME || "TraqGym"),
    getSetting("gym_logo", ""),
  ]);

  return (
    <div className="min-h-screen flex bg-background relative overflow-hidden">
      {/* Background orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-primary/5 dark:bg-primary/10 blur-[100px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-[oklch(0.65_0.15_230_/_0.04)] dark:bg-[oklch(0.65_0.15_230_/_0.08)] blur-[100px]" />
      </div>

      <div className="absolute top-5 right-5 z-10">
        <ThemeToggle />
      </div>

      <div className="flex-1 flex items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="w-full max-w-[480px]">
          {/* Brand header */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {gymLogo ? (
              <Image
                src={gymLogo}
                alt={gymName}
                width={40}
                height={40}
                className="object-contain"
                unoptimized
                priority
              />
            ) : null}
            <span className="font-semibold text-xl text-primary leading-tight">
              {gymName}
            </span>
          </div>

          <Card className="relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

            <CardContent className="px-6 sm:px-8 pt-6 pb-2 text-center">
              <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-primary/10 border border-primary/10 mb-5">
                <Compass className="size-7 text-primary" />
              </div>

              <p className="text-xs font-semibold tracking-[0.2em] text-primary/70 uppercase mb-2">
                Error 404
              </p>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Page not found
              </h1>
              <p className="mt-3 text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
                The page you&apos;re looking for doesn&apos;t exist or may have
                been moved. Check the URL or head back to a familiar place.
              </p>

              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/login" className={buttonVariants({ variant: "default" })}>
                  <LogIn className="size-4" />
                  Go to sign in
                </Link>
                <Link href="/" className={buttonVariants({ variant: "outline" })}>
                  <Home className="size-4" />
                  Go home
                </Link>
              </div>
            </CardContent>

            <CardFooter className="px-6 sm:px-8 py-4 border-t border-border/30 bg-muted/20 dark:bg-white/[0.02] justify-center">
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/60">
                <Shield className="size-3" />
                Powered by{" "}
                <span className="font-medium text-muted-foreground/80">
                  TraqGym
                </span>
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
