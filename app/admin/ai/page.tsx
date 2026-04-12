import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AiChat } from "./ai-chat";

export const metadata = { title: "Ask AI" };

export default async function AiPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") redirect("/login");

  return (
    <AiChat
      workerName={session.user.name || "Staff"}
      role={session.user.role}
    />
  );
}
