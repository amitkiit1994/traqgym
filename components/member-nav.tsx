"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GymBrand } from "@/components/gym-brand";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  getMemberInAppNotifications,
  getMemberInAppUnreadCount,
  markMemberInAppRead,
  markAllMemberInAppRead,
} from "@/lib/actions/member-notifications";
import { NotificationBell } from "@/components/notification-bell";
import { Menu, X } from "lucide-react";

const navItems = [
  { href: "/member", label: "Home" },
  { href: "/member/stats", label: "Stats" },
  { href: "/member/profile", label: "Profile" },
  { href: "/member/invoices", label: "Invoices" },
  { href: "/member/measurements", label: "Measurements" },
  { href: "/member/classes", label: "Classes" },
  { href: "/member/announcements", label: "Announcements" },
  { href: "/member/referrals", label: "Referrals" },
  { href: "/member/waivers", label: "Waivers" },
  { href: "/member/workout", label: "Workout" },
  { href: "/member/diet", label: "Diet" },
  { href: "/member/bookings", label: "Bookings" },
  { href: "/member/notifications", label: "Notifications" },
];

export function MemberNav({ memberName }: { memberName: string }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-2xl backdrop-saturate-[1.4] shadow-[0_1px_8px_oklch(0.565_0.20_275_/_5%)] dark:shadow-[0_1px_20px_oklch(0.65_0.18_275_/_4%)]">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2 sm:gap-4 md:gap-6 min-w-0">
          <GymBrand size="sm" className="text-primary shrink-0" />
          <span className="font-semibold text-sm hidden sm:inline truncate">{memberName}</span>

          {/* Desktop nav */}
          <div className="hidden md:flex gap-1">
            {navItems.map((item) => {
              const isActive =
                item.href === "/member"
                  ? pathname === "/member"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-3 py-1.5 text-sm rounded-lg transition-all duration-200",
                    isActive
                      ? "bg-primary/15 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <NotificationBell
            fetchUnreadCount={getMemberInAppUnreadCount}
            fetchNotifications={getMemberInAppNotifications}
            markRead={markMemberInAppRead}
            markAllRead={markAllMemberInAppRead}
            allHref="/member/in-app-notifications"
          />
          <ThemeToggle size="sm" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="hidden md:inline-flex border-border/50 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20 transition-all duration-200"
          >
            Logout
          </Button>

          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden p-2"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-2xl px-4 py-3 space-y-1 dark:shadow-[0_8px_30px_oklch(0_0_0_/_30%)]">
          {navItems.map((item) => {
            const isActive =
              item.href === "/member"
                ? pathname === "/member"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "block px-3 py-2 text-sm rounded-lg transition-all duration-200",
                  isActive
                    ? "nav-active-pill font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:scale-[1.03] transition-transform"
                )}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="pt-2 border-t border-border/30">
            <Button
              variant="outline"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="w-full border-border/50 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20 transition-all duration-200"
            >
              Logout
            </Button>
          </div>
        </div>
      )}
    </nav>
  );
}
