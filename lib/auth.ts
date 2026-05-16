import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

// Fail-fast: refuse to boot in production if NEXTAUTH_SECRET is missing or
// is the .env.example placeholder. A weak/missing secret means JWTs are
// signable by anyone with the source code.
if (process.env.NODE_ENV === "production") {
  const secret = process.env.NEXTAUTH_SECRET ?? "";
  if (!secret) {
    throw new Error(
      "NEXTAUTH_SECRET is required in production. Generate one with `openssl rand -base64 32` and set it in your Vercel project's env vars."
    );
  }
  if (secret.toLowerCase().includes("change-me") || secret.length < 32) {
    throw new Error(
      "NEXTAUTH_SECRET appears to be the .env.example placeholder or too short. Generate a real secret with `openssl rand -base64 32`."
    );
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // Try Worker first (admin/staff)
        const worker = await prisma.worker.findUnique({
          where: { email: credentials.email },
        });
        if (worker && worker.isActive) {
          const valid = await bcrypt.compare(credentials.password, worker.password);
          if (valid) {
            try {
              await prisma.auditLog.create({
                data: {
                  action: "login",
                  actorType: "worker",
                  actorId: worker.id,
                  status: "success",
                  details: JSON.stringify({ email: worker.email, role: worker.role }),
                },
              });
            } catch {
              // fire-and-forget: don't break login if audit fails
            }
            // A worker is treated as a "trainer" if their role is explicitly
            // 'trainer' OR they currently have at least one active PtPackage
            // assigned. We precompute this at signin so middleware (Edge
            // runtime, no Prisma) can route trainers away from /admin/*.
            let isTrainer = worker.role === "trainer";
            if (!isTrainer) {
              const pkg = await prisma.ptPackage.findFirst({
                where: { trainerId: worker.id, status: "active" },
                select: { id: true },
              });
              isTrainer = !!pkg;
            }
            return {
              id: String(worker.id),
              email: worker.email,
              name: `${worker.firstname} ${worker.lastname}`,
              actorType: "worker" as const,
              role: worker.role,
              locationId: worker.locationId,
              isTrainer,
            } as any;
          }
        }

        // Then try User (member)
        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (user) {
          const valid = await bcrypt.compare(credentials.password, user.password);
          if (valid) {
            try {
              await prisma.auditLog.create({
                data: {
                  action: "login",
                  actorType: "member",
                  actorId: user.id,
                  status: "success",
                  details: JSON.stringify({ email: user.email, role: "member" }),
                },
              });
            } catch {
              // fire-and-forget: don't break login if audit fails
            }
            return {
              id: String(user.id),
              email: user.email,
              name: `${user.firstname} ${user.lastname}`,
              actorType: "member" as const,
              role: "member",
              locationId: user.locationId,
            };
          }
        }

        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.actorType = (user as any).actorType;
        token.role = (user as any).role;
        token.locationId = (user as any).locationId;
        (token as any).isTrainer = (user as any).isTrainer === true;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).actorType = token.actorType;
        (session.user as any).role = token.role;
        (session.user as any).locationId = token.locationId;
        (session.user as any).isTrainer = (token as any).isTrainer === true;
      }
      return session;
    },
    // No `redirect` callback: post-login routing is handled by the login
    // page (client-side router.push) and enforced by middleware, which
    // bounces trainers off /admin/* to /trainer/dashboard.
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },
};
