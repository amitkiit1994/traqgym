import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ChangePasswordForm } from "./change-password-form";
import { EditProfileForm } from "./edit-profile-form";

export default async function MemberProfilePage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "member") {
    redirect("/login");
  }

  const userId = parseInt(session.user.id);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { location: { select: { name: true } } },
  });

  if (!user) redirect("/login");

  const fmtDateInput = (d: Date | null | undefined) =>
    d ? d.toISOString().slice(0, 10) : null;
  const fmtDateDisplay = (d: Date | null | undefined) =>
    d
      ? d.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : null;

  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-6">
      <h1 className="text-2xl font-bold">Profile</h1>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>
            {user.firstname} {user.lastname}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Email</span>
            <span>{user.email}</span>
          </div>
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Phone</span>
            <span>{user.phone || "—"}</span>
          </div>
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Address</span>
            <span className="text-right">{user.address || "—"}</span>
          </div>
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Date of Birth</span>
            <span>{fmtDateDisplay(user.birthdate) || "—"}</span>
          </div>
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Location</span>
            <span>{user.location?.name || "—"}</span>
          </div>
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Member Since</span>
            <span>{fmtDateDisplay(user.createdAt)}</span>
          </div>
        </CardContent>
      </Card>

      <EditProfileForm
        email={user.email}
        birthdate={fmtDateDisplay(user.birthdate)}
        firstname={user.firstname}
        lastname={user.lastname}
        phone={user.phone}
        alternatePhone={user.alternatePhone}
        gender={user.gender}
        address={user.address}
        occupation={user.occupation}
        anniversaryDate={fmtDateInput(user.anniversaryDate)}
        govtId={user.govtId}
        gstin={user.gstin}
      />

      <ChangePasswordForm />
    </div>
  );
}
