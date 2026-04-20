"use client";

import { useState, useTransition } from "react";
import { updateMemberProfile, type MemberProfileInput } from "@/lib/actions/member-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Pencil, X } from "lucide-react";

type Props = {
  email: string;
  birthdate: string | null;
  firstname: string;
  lastname: string;
  phone: string | null;
  alternatePhone: string | null;
  gender: string | null;
  address: string | null;
  occupation: string | null;
  anniversaryDate: string | null;
  govtId: string | null;
  gstin: string | null;
};

export function EditProfileForm(props: Props) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<MemberProfileInput>({
    firstname: props.firstname,
    lastname: props.lastname,
    phone: props.phone || "",
    alternatePhone: props.alternatePhone || "",
    gender: props.gender || "",
    address: props.address || "",
    occupation: props.occupation || "",
    anniversaryDate: props.anniversaryDate || "",
    govtId: props.govtId || "",
    gstin: props.gstin || "",
  });
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateMemberProfile(form);
      if (result.success) {
        toast.success("Profile updated");
        setEditing(false);
      } else {
        toast.error(result.error || "Failed to update");
      }
    });
  };

  if (!editing) {
    return (
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
        <Pencil className="size-3.5 mr-1.5" />
        Edit Profile
      </Button>
    );
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Edit Profile</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)} aria-label="Close">
          <X className="size-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>First Name</Label>
            <Input
              value={form.firstname}
              onChange={(e) => setForm({ ...form, firstname: e.target.value })}
              required
            />
          </div>
          <div>
            <Label>Last Name</Label>
            <Input
              value={form.lastname}
              onChange={(e) => setForm({ ...form, lastname: e.target.value })}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Email (login, read-only)</Label>
            <Input value={props.email} disabled readOnly />
          </div>
          <div>
            <Label>Date of Birth (read-only)</Label>
            <Input
              value={props.birthdate || "—"}
              disabled
              readOnly
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Phone</Label>
            <Input
              value={form.phone || ""}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="10-digit number"
              maxLength={10}
              inputMode="numeric"
            />
          </div>
          <div>
            <Label>Emergency / Alternate Phone</Label>
            <Input
              value={form.alternatePhone || ""}
              onChange={(e) => setForm({ ...form, alternatePhone: e.target.value })}
              placeholder="10-digit number"
              maxLength={10}
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Gender</Label>
            <select
              className="w-full h-9 px-3 rounded-md border bg-transparent text-sm"
              value={form.gender || ""}
              onChange={(e) => setForm({ ...form, gender: e.target.value })}
            >
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <Label>Anniversary Date</Label>
            <Input
              type="date"
              value={form.anniversaryDate || ""}
              onChange={(e) => setForm({ ...form, anniversaryDate: e.target.value })}
            />
          </div>
        </div>

        <div>
          <Label>Address</Label>
          <Input
            value={form.address || ""}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Street, area, city, pincode"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Occupation</Label>
            <Input
              value={form.occupation || ""}
              onChange={(e) => setForm({ ...form, occupation: e.target.value })}
            />
          </div>
          <div>
            <Label>Govt. ID</Label>
            <Input
              value={form.govtId || ""}
              onChange={(e) => setForm({ ...form, govtId: e.target.value })}
              placeholder="Aadhaar / PAN / DL"
            />
          </div>
        </div>

        <div>
          <Label>GSTIN (optional, for B2B invoices)</Label>
          <Input
            value={form.gstin || ""}
            onChange={(e) => setForm({ ...form, gstin: e.target.value })}
            maxLength={15}
          />
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} disabled={isPending} size="sm">
            {isPending ? "Saving..." : "Save Changes"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
