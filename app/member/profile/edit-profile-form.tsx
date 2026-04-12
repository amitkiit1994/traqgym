"use client";

import { useState, useTransition } from "react";
import { updateMemberProfile } from "@/lib/actions/member-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Pencil, X } from "lucide-react";

export function EditProfileForm({
  firstname,
  lastname,
  phone,
}: {
  firstname: string;
  lastname: string;
  phone: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    firstname,
    lastname,
    phone: phone || "",
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
    <div className="space-y-3 p-4 border rounded-lg">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Edit Profile</p>
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>First Name</Label>
          <Input
            value={form.firstname}
            onChange={(e) => setForm({ ...form, firstname: e.target.value })}
          />
        </div>
        <div>
          <Label>Last Name</Label>
          <Input
            value={form.lastname}
            onChange={(e) => setForm({ ...form, lastname: e.target.value })}
          />
        </div>
      </div>
      <div>
        <Label>Phone</Label>
        <Input
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="10-digit number"
          maxLength={10}
        />
      </div>
      <Button onClick={handleSave} disabled={isPending} size="sm">
        {isPending ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  );
}
