"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMemberReferral } from "@/lib/actions/member-referral";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export function ReferralForm() {
  const router = useRouter();
  const [refereeName, setRefereeName] = useState("");
  const [refereePhone, setRefereePhone] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const reset = () => {
    setRefereeName("");
    setRefereePhone("");
    setMessage("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await createMemberReferral({
        refereeName,
        refereePhone,
        message: message.trim() || undefined,
      });
      if (result.success) {
        toast.success("Referral submitted — thanks!");
        reset();
        router.refresh();
      } else {
        toast.error(result.error || "Failed to submit referral");
      }
    });
  };

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-base">Refer a friend</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="refereeName">Friend&apos;s name</Label>
            <Input
              id="refereeName"
              value={refereeName}
              onChange={(e) => setRefereeName(e.target.value)}
              placeholder="Full name"
              required
            />
          </div>
          <div>
            <Label htmlFor="refereePhone">Friend&apos;s phone</Label>
            <Input
              id="refereePhone"
              value={refereePhone}
              onChange={(e) => setRefereePhone(e.target.value.replace(/\D/g, ""))}
              placeholder="10-digit number"
              maxLength={10}
              inputMode="numeric"
              required
            />
          </div>
          <div>
            <Label htmlFor="message">Message (optional)</Label>
            <Input
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="A short note to share"
              maxLength={200}
            />
          </div>
          <Button type="submit" disabled={isPending} size="sm">
            {isPending ? "Submitting..." : "Submit referral"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
