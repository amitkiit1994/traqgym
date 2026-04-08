import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

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
            return {
              id: String(worker.id),
              email: worker.email,
              name: `${worker.firstname} ${worker.lastname}`,
              actorType: "worker" as const,
              role: worker.role,
              locationId: worker.locationId,
            };
          }
        }

        // Then try User (member)
        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (user) {
          const valid = await bcrypt.compare(credentials.password, user.password);
          if (valid) {
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
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).actorType = token.actorType;
        (session.user as any).role = token.role;
        (session.user as any).locationId = token.locationId;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
};
