import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MemberNav } from "@/components/member-nav";

export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "member") {
    redirect("/login");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <MemberNav memberName={session.user.name} />
      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
