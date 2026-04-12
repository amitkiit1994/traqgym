import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AiActivityClient } from "./ai-activity-client";

export default async function AiActivityPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if ((session.user as any).role !== "admin") redirect("/admin/dashboard");

  return <AiActivityClient />;
}
