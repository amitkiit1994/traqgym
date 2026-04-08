import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // Admin routes: only workers (admin/staff)
    if (pathname.startsWith("/admin")) {
      if (token?.actorType !== "worker") {
        return NextResponse.redirect(new URL("/login", req.url));
      }
    }

    // Member routes: only members
    if (pathname.startsWith("/member")) {
      if (token?.actorType !== "member") {
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
  matcher: ["/admin/:path*", "/member/:path*"],
};
