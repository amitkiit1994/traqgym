import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

const STAFF_RESTRICTED_PATHS = [
  "/admin/workers",
  "/admin/reports",
  // C3: refunds are admin-only. Page-level guard lives in
  // app/admin/refunds/page.tsx (owned by another agent); we add the path
  // here so staff get a 307 to /admin/dashboard before the page renders.
  "/admin/refunds",
];

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;
    const isTrainer =
      token?.role === "trainer" || (token as { isTrainer?: boolean } | null)?.isTrainer === true;

    // Admin routes: only workers (admin/staff). Trainers and members are
    // bounced to their respective home pages instead of /login (which would
    // nuke the session for a logged-in member).
    if (pathname.startsWith("/admin")) {
      if (token?.actorType !== "worker") {
        // Logged-in member visiting /admin/* — send to /member, not /login.
        if (token?.actorType === "member") {
          return NextResponse.redirect(new URL("/member", req.url));
        }
        return NextResponse.redirect(new URL("/login", req.url));
      }

      // C1 + C2: trainers must not access /admin/* at all. Bounce them to
      // their dedicated dashboard. This also fixes the post-login flow:
      // when the login page router.pushes /admin/dashboard for any worker,
      // middleware here redirects trainers to /trainer/dashboard.
      if (isTrainer) {
        return NextResponse.redirect(
          new URL("/trainer/dashboard", req.url)
        );
      }

      // Staff role restrictions
      if (token?.role === "staff") {
        const isRestricted = STAFF_RESTRICTED_PATHS.some((p) =>
          pathname.startsWith(p)
        );
        // Staff can view locations but not create/edit (POST handled server-side)
        if (
          pathname.startsWith("/admin/locations") &&
          (pathname.includes("/new") || pathname.includes("/edit"))
        ) {
          return NextResponse.redirect(
            new URL("/admin/dashboard", req.url)
          );
        }
        if (isRestricted) {
          return NextResponse.redirect(
            new URL("/admin/dashboard", req.url)
          );
        }
      }
    }

    // Member routes: only members. Workers visiting /member/* get sent to
    // /admin/dashboard (or /trainer/dashboard if they're a trainer) rather
    // than /login, to avoid clearing their session.
    if (pathname.startsWith("/member")) {
      if (token?.actorType !== "member") {
        if (token?.actorType === "worker") {
          return NextResponse.redirect(
            new URL(isTrainer ? "/trainer/dashboard" : "/admin/dashboard", req.url)
          );
        }
        return NextResponse.redirect(new URL("/login", req.url));
      }
    }

    // Trainer routes: only workers (admin/staff). The page-level
    // requireTrainer() guard further restricts to workers who actually have
    // PT packages assigned.
    if (pathname.startsWith("/trainer")) {
      if (token?.actorType !== "worker") {
        if (token?.actorType === "member") {
          return NextResponse.redirect(new URL("/member", req.url));
        }
        return NextResponse.redirect(new URL("/login", req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: ["/admin/:path*", "/member/:path*", "/trainer/:path*"],
};
