import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      actorType: "worker" | "member";
      role: "admin" | "staff" | "member";
      locationId: number | null;
    };
  }

  interface User {
    actorType: "worker" | "member";
    role: string;
    locationId: number | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    actorType: "worker" | "member";
    role: string;
    locationId: number | null;
  }
}
