"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { GymBrand } from "@/components/gym-brand";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
} from "@/components/ui/drawer";
import {
  LayoutDashboard,
  Users,
  RefreshCw,
  Ticket,
  MapPin,
  ClipboardCheck,
  CalendarDays,
  CalendarCheck,
  CalendarClock,
  Fingerprint,
  Bell,
  UserCog,
  FileBarChart,
  CalendarOff,
  User,
  Settings,
  UserPlus,
  TrendingUp,
  Tag,
  MessageSquare,
  MessageCircle,
  Activity,
  Wallet,
  ScrollText,
  Megaphone,
  Dumbbell,
  Sparkles,
  Gem,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  AlertCircle,
  IndianRupee,
  ShoppingCart,
  Building2,
  Gift,
  FileCheck,
  Apple,
  Bot,
  Menu,
  Lock,
  ShieldCheck,
  HeartPulse,
  Undo2,
  BookOpen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type SidebarCounts = {
  pendingFollowups: number;
  newEnquiries: number;
  balanceDueCount: number;
  pendingLeaves: number;
  pendingApprovalsCount: number;
  pendingRefundsCount: number;
  openShiftsCount: number;
};

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { href: "/admin/my-dashboard", label: "My Dashboard", icon: User },
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/attendance", label: "Attendance", icon: ClipboardCheck },
      { href: "/admin/classes", label: "Classes", icon: CalendarDays },
      { href: "/admin/biometric", label: "Biometric", icon: Fingerprint },
      { href: "/admin/pos", label: "POS", icon: ShoppingCart },
      { href: "/admin/facility-bookings", label: "Facilities", icon: Building2 },
      { href: "/admin/workout", label: "Workout Plans", icon: Dumbbell },
      { href: "/admin/diet", label: "Diet Plans", icon: Apple },
      { href: "/admin/appointments", label: "Appointments", icon: CalendarCheck },
    ],
  },
  {
    label: "Members",
    items: [
      { href: "/admin/members", label: "Members", icon: Users },
      { href: "/admin/enquiries", label: "Enquiries", icon: UserPlus },
      { href: "/admin/renewals", label: "Renewals", icon: RefreshCw },
      { href: "/admin/comps", label: "Comps", icon: Gem, adminOnly: true },
      { href: "/admin/waivers", label: "Waivers", icon: FileCheck },
      { href: "/admin/family", label: "Family Groups", icon: Users },
      { href: "/admin/pt", label: "PT Packages", icon: HeartPulse, adminOnly: true },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/admin/plans", label: "Plans", icon: Ticket },
      { href: "/admin/promos", label: "Promos", icon: Tag },
      { href: "/admin/expenses", label: "Expenses", icon: Wallet, adminOnly: true },
      { href: "/admin/payroll", label: "Payroll", icon: Wallet, adminOnly: true },
      { href: "/admin/gift-cards", label: "Gift Cards", icon: Gift },
      { href: "/admin/balance-due", label: "Balance Due", icon: IndianRupee },
      { href: "/admin/payment-schedules", label: "Payment Schedules", icon: CalendarClock },
      { href: "/admin/followups", label: "Followups", icon: AlertCircle },
      { href: "/admin/refunds", label: "Refunds", icon: Undo2, adminOnly: true },
      { href: "/admin/reports", label: "Reports", icon: FileBarChart, adminOnly: true },
      { href: "/admin/reports/multi-location", label: "Multi-Location", icon: Building2, adminOnly: true },
    ],
  },
  {
    label: "Staff",
    items: [
      { href: "/admin/workers", label: "Workers", icon: UserCog, adminOnly: true },
      { href: "/admin/leaves", label: "Leaves", icon: CalendarOff },
      { href: "/admin/staff-performance", label: "Performance", icon: TrendingUp, adminOnly: true },
      { href: "/admin/staff-calendar", label: "Staff Calendar", icon: CalendarDays },
    ],
  },
  {
    label: "Communications",
    items: [
      { href: "/admin/notifications", label: "Notifications", icon: Bell },
      { href: "/admin/bulk-notify", label: "Bulk Notify", icon: MessageSquare },
      { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
      { href: "/admin/feedback", label: "Feedback", icon: MessageCircle },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/admin/approvals", label: "Approvals", icon: ShieldCheck, adminOnly: true },
      { href: "/admin/shifts", label: "Cash Shifts", icon: BookOpen },
      { href: "/admin/in-app-notifications", label: "Alerts", icon: AlertCircle },
      { href: "/admin/locations", label: "Locations", icon: MapPin },
      { href: "/admin/equipment", label: "Equipment", icon: Dumbbell },
      { href: "/admin/lockers", label: "Lockers", icon: Lock, adminOnly: true },
      { href: "/admin/settings", label: "Settings", icon: Settings, adminOnly: true },
      { href: "/admin/audit", label: "Audit Log", icon: ScrollText, adminOnly: true },
      { href: "/admin/activity", label: "Activity", icon: Activity },
    ],
  },
];

const BADGE_MAP: Record<string, keyof SidebarCounts> = {
  "/admin/followups": "pendingFollowups",
  "/admin/enquiries": "newEnquiries",
  "/admin/balance-due": "balanceDueCount",
  "/admin/leaves": "pendingLeaves",
  "/admin/approvals": "pendingApprovalsCount",
  "/admin/refunds": "pendingRefundsCount",
  "/admin/shifts": "openShiftsCount",
};

export function AdminSidebar({
  role = "admin",
  counts,
}: {
  role?: string;
  counts?: SidebarCounts;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    navGroups.forEach((g) => {
      initial[g.label] = false;
    });
    // Expand the group containing the current page
    for (const g of navGroups) {
      if (g.items.some((item) => pathname.startsWith(item.href))) {
        initial[g.label] = true;
        break;
      }
    }
    return initial;
  });

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <aside
      className={cn(
        "hidden md:flex h-full flex-col border-r border-sidebar-border bg-sidebar/70 backdrop-blur-xl backdrop-saturate-[1.4] dark:bg-card/40 dark:backdrop-blur-2xl transition-all duration-200",
        collapsed ? "w-14" : "w-56",
      )}
    >
      {/* Header */}
      <div className="flex h-14 items-center border-b border-sidebar-border px-2">
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="mx-auto p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        ) : (
          <>
            <div className="flex-1 px-2">
              <GymBrand size="sm" className="text-primary" />
            </div>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </>
        )}
      </div>

      <nav className={cn("flex-1 overflow-y-auto space-y-1", collapsed ? "p-1" : "p-2")}>
        {navGroups.map((group) => {
          const visibleItems = group.items.filter(
            (item) => !(item.adminOnly && role === "staff")
          );
          if (visibleItems.length === 0) return null;

          const isOpen = openGroups[group.label] ?? true;

          return (
            <div key={group.label}>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-all duration-200 hover:tracking-widest"
                >
                  {isOpen ? (
                    <ChevronDown className="size-3" />
                  ) : (
                    <ChevronRight className="size-3" />
                  )}
                  {group.label}
                </button>
              )}
              {(collapsed || isOpen) && (
                <div className={cn("space-y-0.5", !collapsed && "mt-0.5")}>
                  {visibleItems.map((item) => {
                    const active =
                      item.href === "/admin/dashboard"
                        ? pathname === "/admin/dashboard"
                        : pathname.startsWith(item.href);
                    const Icon = item.icon;

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "flex items-center rounded-lg text-sm font-medium transition-all duration-200",
                          collapsed ? "justify-center p-2" : "gap-2.5 px-3 py-2",
                          active
                            ? "sidebar-active-glow text-primary font-semibold"
                            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:translate-x-0.5 transition-transform"
                        )}
                      >
                        <Icon className={cn("size-4 shrink-0", active && "drop-shadow-[0_0_4px_rgba(129,140,248,0.4)]")} />
                        {!collapsed && item.label}
                        {!collapsed &&
                          counts &&
                          BADGE_MAP[item.href] &&
                          counts[BADGE_MAP[item.href]] > 0 && (
                            <span className="ml-auto inline-flex min-w-5 h-5 px-1.5 items-center justify-center rounded-full bg-destructive text-white text-[10px] font-semibold">
                              {counts[BADGE_MAP[item.href]]}
                            </span>
                          )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className={cn("border-t border-sidebar-border space-y-1", collapsed ? "p-1" : "p-2")}>
        <Link
          href="/admin/ai"
          title={collapsed ? "Ask AI" : undefined}
          className={cn(
            "flex items-center rounded-lg text-sm font-medium transition-all duration-200",
            collapsed ? "justify-center p-2" : "gap-2.5 px-3 py-2",
            pathname === "/admin/ai"
              ? "bg-primary/15 text-primary font-semibold"
              : "bg-primary/8 text-primary hover:bg-primary/15 glow-btn shine"
          )}
        >
          <Sparkles className={cn("size-4 shrink-0", pathname === "/admin/ai" && "drop-shadow-[0_0_4px_rgba(129,140,248,0.4)]")} />
          {!collapsed && "Ask AI"}
        </Link>
        <Link
          href="/admin/ai-activity"
          title={collapsed ? "AI Activity" : undefined}
          className={cn(
            "flex items-center rounded-lg text-sm transition-all duration-200",
            collapsed ? "justify-center p-2" : "gap-2.5 px-3 py-2",
            pathname.startsWith("/admin/ai-activity")
              ? "sidebar-active-glow text-primary font-semibold"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:translate-x-0.5 transition-transform"
          )}
        >
          <Bot className="size-4 shrink-0" />
          {!collapsed && "AI Activity"}
        </Link>
        {!collapsed && (
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs text-muted-foreground">Theme</span>
            <ThemeToggle size="sm" />
          </div>
        )}
        {collapsed && (
          <div className="flex justify-center py-1">
            <ThemeToggle size="sm" />
          </div>
        )}
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          title={collapsed ? "Logout" : undefined}
          className={cn(
            "flex w-full items-center rounded-lg text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-200",
            collapsed ? "justify-center p-2" : "gap-2.5 px-3 py-2",
          )}
        >
          <LogOut className="size-4 shrink-0" />
          {!collapsed && "Logout"}
        </button>
      </div>
    </aside>
  );
}

export function AdminMobileMenu({
  role = "admin",
  counts,
}: {
  role?: string;
  counts?: SidebarCounts;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        className="inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors md:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </DrawerTrigger>
      <DrawerContent showCloseButton>
        {/* Header */}
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <GymBrand size="sm" className="text-primary" />
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto space-y-1 p-2">
          {navGroups.map((group) => {
            const visibleItems = group.items.filter(
              (item) => !(item.adminOnly && role === "staff")
            );
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.label}>
                <span className="flex w-full items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                  {group.label}
                </span>
                <div className="space-y-0.5 mt-0.5">
                  {visibleItems.map((item) => {
                    const active =
                      item.href === "/admin/dashboard"
                        ? pathname === "/admin/dashboard"
                        : pathname.startsWith(item.href);
                    const Icon = item.icon;

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
                          active
                            ? "sidebar-active-glow text-primary font-semibold"
                            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        )}
                      >
                        <Icon className={cn("size-4 shrink-0", active && "drop-shadow-[0_0_4px_rgba(129,140,248,0.4)]")} />
                        {item.label}
                        {counts &&
                          BADGE_MAP[item.href] &&
                          counts[BADGE_MAP[item.href]] > 0 && (
                            <span className="ml-auto inline-flex min-w-5 h-5 px-1.5 items-center justify-center rounded-full bg-destructive text-white text-[10px] font-semibold">
                              {counts[BADGE_MAP[item.href]]}
                            </span>
                          )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className="border-t border-sidebar-border space-y-1 p-2">
          <Link
            href="/admin/ai"
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
              pathname === "/admin/ai"
                ? "bg-primary/15 text-primary font-semibold"
                : "bg-primary/8 text-primary hover:bg-primary/15 glow-btn shine"
            )}
          >
            <Sparkles className={cn("size-4 shrink-0", pathname === "/admin/ai" && "drop-shadow-[0_0_4px_rgba(129,140,248,0.4)]")} />
            Ask AI
          </Link>
          <Link
            href="/admin/ai-activity"
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all duration-200",
              pathname.startsWith("/admin/ai-activity")
                ? "sidebar-active-glow text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            <Bot className="size-4 shrink-0" />
            AI Activity
          </Link>
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs text-muted-foreground">Theme</span>
            <ThemeToggle size="sm" />
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-200"
          >
            <LogOut className="size-4 shrink-0" />
            Logout
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
