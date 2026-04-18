import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

const STAFF_RESTRICTED_PATHS = [
  "/admin/workers",
  "/admin/reports",
];

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // Admin routes: only workers (admin/staff)
    if (pathname.startsWith("/admin")) {
      if (token?.actorType !== "worker") {
        return NextResponse.redirect(new URL("/login", req.url));
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

    // Member routes: only members
    if (pathname.startsWith("/member")) {
      if (token?.actorType !== "member") {
        return NextResponse.redirect(new URL("/login", req.url));
      }
    }

    // Trainer routes: only workers (admin/staff). The page-level
    // requireTrainer() guard further restricts to workers who actually have
    // PT packages assigned.
    if (pathname.startsWith("/trainer")) {
      if (token?.actorType !== "worker") {
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
