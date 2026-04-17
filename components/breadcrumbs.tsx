"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const labels: Record<string, string> = {
  dashboard: "Dashboard",
  members: "Members",
  renewals: "Renewals",
  plans: "Plans",
  locations: "Locations",
  workers: "Workers",
  enquiries: "Enquiries",
  attendance: "Attendance",
  biometric: "Biometric",
  notifications: "Notifications",
  promos: "Promos",
  "bulk-notify": "Bulk Notify",
  "staff-performance": "Performance",
  activity: "Activity",
  expenses: "Expenses",
  audit: "Audit Log",
  announcements: "Announcements",
  equipment: "Equipment",
  reports: "Reports",
  settings: "Settings",
  leaves: "Leaves",
  "my-dashboard": "My Dashboard",
  ai: "Ask AI",
  classes: "Classes",
  appointments: "Appointments",
  "balance-due": "Balance Due",
  "facility-bookings": "Facilities",
  family: "Family Groups",
  followups: "Followups",
  feedback: "Feedback",
  "gift-cards": "Gift Cards",
  "in-app-notifications": "Alerts",
  lockers: "Lockers",
  payroll: "Payroll",
  pos: "POS",
  "staff-calendar": "Staff Calendar",
  waivers: "Waivers",
  workout: "Workout Plans",
  diet: "Diet Plans",
  "ai-activity": "AI Activity",
  unmatched: "Unmatched",
};

// Map each page segment to its sidebar group
const sectionGroup: Record<string, string> = {
  "my-dashboard": "Operations",
  dashboard: "Operations",
  attendance: "Operations",
  classes: "Operations",
  biometric: "Operations",
  pos: "Operations",
  "facility-bookings": "Operations",
  workout: "Operations",
  diet: "Operations",
  appointments: "Operations",
  members: "Members",
  enquiries: "Members",
  renewals: "Members",
  waivers: "Members",
  family: "Members",
  plans: "Finance",
  promos: "Finance",
  expenses: "Finance",
  payroll: "Finance",
  "gift-cards": "Finance",
  "balance-due": "Finance",
  followups: "Finance",
  reports: "Finance",
  workers: "Staff",
  leaves: "Staff",
  "staff-performance": "Staff",
  "staff-calendar": "Staff",
  notifications: "Communications",
  "bulk-notify": "Communications",
  announcements: "Communications",
  feedback: "Communications",
  "in-app-notifications": "System",
  locations: "System",
  equipment: "System",
  lockers: "System",
  settings: "System",
  audit: "System",
  activity: "System",
  ai: "Assistant",
  "ai-activity": "Assistant",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  const adminIndex = segments.indexOf("admin");
  if (adminIndex === -1) return null;
  const crumbSegments = segments.slice(adminIndex + 1);

  if (crumbSegments.length === 0) return null;

  const firstSeg = crumbSegments[0];
  const group = sectionGroup[firstSeg];

  const crumbs = crumbSegments.map((seg, i) => {
    const isNumeric = /^\d+$/.test(seg);
    const parentLabel = i > 0 ? (labels[crumbSegments[i - 1]] || crumbSegments[i - 1]) : "";
    const label = isNumeric
      ? parentLabel ? `${parentLabel.replace(/s$/, "")} Detail` : "Detail"
      : labels[seg] || seg;
    const href = "/admin/" + crumbSegments.slice(0, i + 1).join("/");
    const isLast = i === crumbSegments.length - 1;
    return { label, href, isLast };
  });

  return (
    <nav className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
      {group && (
        <>
          <span className="text-muted-foreground/60">{group}</span>
          <span>/</span>
        </>
      )}
      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1">
          {crumb !== crumbs[0] && <span>/</span>}
          {crumb.isLast ? (
            <span className="text-foreground font-medium">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="hover:text-foreground">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
