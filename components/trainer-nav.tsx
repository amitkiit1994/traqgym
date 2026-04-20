"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GymBrand } from "@/components/gym-brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { LayoutDashboard, Users, CalendarDays, Wallet } from "lucide-react";

const navItems = [
  { href: "/trainer/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trainer/clients", label: "Clients", icon: Users },
  { href: "/trainer/sessions", label: "Sessions", icon: CalendarDays },
  { href: "/trainer/payouts", label: "Payouts", icon: Wallet },
];

export function TrainerNav({ trainerName }: { trainerName: string }) {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-2xl backdrop-saturate-[1.4] shadow-[0_1px_8px_oklch(0.565_0.20_275_/_5%)] dark:shadow-[0_1px_20px_oklch(0.65_0.18_275_/_4%)]">
      {/* Top bar with brand + actions — hidden on mobile to save vertical space */}
      <div className="hidden sm:flex items-center justify-between px-3 sm:px-4 py-2 gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <GymBrand size="sm" className="text-primary shrink-0" />
          <span className="font-semibold text-sm truncate">
            {trainerName}
          </span>
          <span className="text-xs text-muted-foreground">Trainer</span>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle size="sm" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="border-border/50 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20 transition-all duration-200 px-2 sm:px-3"
          >
            Logout
          </Button>
        </div>
      </div>

      {/* Mobile-only compact bar: brand + theme/logout */}
      <div className="flex sm:hidden items-center justify-between px-3 py-1.5 gap-2">
        <GymBrand size="sm" className="text-primary shrink-0" />
        <div className="flex items-center gap-1">
          <ThemeToggle size="sm" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="border-border/50 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20 transition-all duration-200 px-2 h-7 text-xs"
          >
            Logout
          </Button>
        </div>
      </div>

      {/* Horizontal scrollable pill nav with right-edge fade hint */}
      <div className="relative">
        <div
          className="flex gap-1 px-2 sm:px-4 pb-2 overflow-x-auto scrollbar-thin snap-x snap-mandatory scroll-px-2"
          style={{ scrollbarWidth: "thin" }}
        >
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full whitespace-nowrap transition-all duration-200 shrink-0 snap-start",
                  isActive
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <Icon className="size-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
        {/* Right-edge fade hint to indicate scrollability on narrow viewports */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background/95 to-transparent sm:hidden"
        />
      </div>
    </nav>
  );
}
