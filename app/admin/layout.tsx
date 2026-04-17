import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminSidebar, AdminMobileMenu } from "@/components/admin-sidebar";
import { GlobalSearch } from "@/components/global-search";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AdminNotificationBell } from "@/components/admin-notification-bell";
import { getSidebarCounts } from "@/lib/actions/sidebar-counts";

const zeroCounts = { pendingFollowups: 0, newEnquiries: 0, balanceDueCount: 0, pendingLeaves: 0 };

async function SidebarWithCounts({ role }: { role: string }) {
  const counts = await getSidebarCounts();
  return <AdminSidebar role={role} counts={counts} />;
}

async function MobileMenuWithCounts({ role }: { role: string }) {
  const counts = await getSidebarCounts();
  return <AdminMobileMenu role={role} counts={counts} />;
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const role = (session.user as any).role ?? "staff";

  return (
    <div className="flex h-dvh overflow-x-hidden">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded-lg">
        Skip to content
      </a>
      <Suspense fallback={<AdminSidebar role={role} counts={zeroCounts} />}>
        <SidebarWithCounts role={role} />
      </Suspense>
      <div className="flex flex-1 flex-col min-h-0 min-w-0">
        <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center border-b border-border/50 px-3 md:px-6 gap-2 md:gap-4 bg-background/70 backdrop-blur-2xl backdrop-saturate-[1.8] shadow-[0_1px_8px_oklch(0.565_0.20_25_/_5%),0_1px_2px_oklch(0_0_0_/_3%)] dark:shadow-[0_1px_15px_oklch(0_0_0_/_15%)]">
          <div className="md:hidden">
            <Suspense fallback={<AdminMobileMenu role={role} counts={zeroCounts} />}>
              <MobileMenuWithCounts role={role} />
            </Suspense>
          </div>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <AdminNotificationBell />
            <span className="hidden md:inline text-muted-foreground">
              {session.user.email}
            </span>
            <span className="hidden md:inline font-medium text-foreground">{session.user.name}</span>
          </div>
        </header>
        <main id="main-content" className="flex-1 min-h-0 flex flex-col overflow-hidden p-3 md:p-6">
          <div className="shrink-0"><Breadcrumbs /></div>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
