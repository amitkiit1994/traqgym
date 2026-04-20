"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { issueCompPassAction } from "@/lib/actions/comp";
import { searchMembers } from "@/lib/actions/renewals";
import { getWorkers } from "@/lib/actions/workers";

const REASON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "trial", label: "Trial" },
  { value: "influencer", label: "Influencer" },
  { value: "family", label: "Family" },
  { value: "compensation", label: "Compensation" },
  { value: "owner_friend", label: "Owner Friend" },
  { value: "money_crunch", label: "Money Crunch" },
  { value: "other", label: "Other" },
];

const APPROVAL_DAYS_THRESHOLD = 7;

type Member = {
  id: number;
  firstname: string;
  lastname: string;
  email: string;
  phone: string | null;
};

type Worker = {
  id: number;
  firstname: string;
  lastname: string;
  role: string;
};

function defaultExpiryDate(daysFromNow = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function daysBetween(isoDate: string): number {
  const target = new Date(`${isoDate}T23:59:59`);
  if (isNaN(target.getTime())) return 0;
  const now = new Date();
  return Math.ceil(
    (target.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
  );
}

export function IssueCompPassDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [memberQuery, setMemberQuery] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");

  const [admins, setAdmins] = useState<Worker[]>([]);
  const [reason, setReason] = useState<string>("trial");
  const [reasonDetail, setReasonDetail] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [approverId, setApproverId] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setMemberQuery("");
    setMembers([]);
    setSelectedMemberId("");
    setReason("trial");
    setReasonDetail("");
    setExpiresAt(defaultExpiryDate(7));
    setNotes("");
    setApproverId("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const w = (await getWorkers()) as Worker[];
      if (cancelled) return;
      setAdmins((w ?? []).filter((x) => x.role === "admin"));
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (memberQuery.length < 2) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const result = await searchMembers(memberQuery);
      if (cancelled) return;
      setMembers(result as Member[]);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [memberQuery, open]);

  const computedDays = useMemo(() => daysBetween(expiresAt), [expiresAt]);
  const requiresApproval = computedDays > APPROVAL_DAYS_THRESHOLD;

  const selectedMember = useMemo(
    () => members.find((m) => String(m.id) === selectedMemberId),
    [members, selectedMemberId]
  );

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const userId = parseInt(selectedMemberId, 10);
    if (!Number.isFinite(userId)) {
      setError("Please select a member");
      return;
    }
    if (!expiresAt) {
      setError("Pick an expiry date");
      return;
    }
    if (computedDays <= 0) {
      setError("Expiry date must be in the future");
      return;
    }
    if (requiresApproval && !approverId) {
      setError("Approver required for comp passes longer than 7 days");
      return;
    }

    // Submit the date as end-of-day ISO so the server's expiresAt > now check passes.
    const expiresAtISO = new Date(`${expiresAt}T23:59:59`).toISOString();

    startTransition(async () => {
      const res = await issueCompPassAction({
        userId,
        reason,
        reasonDetail: reasonDetail.trim() || undefined,
        expiresAt: expiresAtISO,
        approvedById: approverId ? parseInt(approverId, 10) : undefined,
        notes: notes.trim() || undefined,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Issue Comp Pass</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="comp-pass-member-search">Member</Label>
            <Input
              id="comp-pass-member-search"
              placeholder="Search by name, email, or phone…"
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              autoComplete="off"
            />
            {selectedMember && (
              <p className="text-xs text-muted-foreground mt-1">
                Selected: {selectedMember.firstname} {selectedMember.lastname}
                {selectedMember.phone ? ` · ${selectedMember.phone}` : ""}
              </p>
            )}
            {members.length > 0 && (
              <Select
                value={selectedMemberId}
                onValueChange={(v) => setSelectedMemberId(v ?? "")}
              >
                <SelectTrigger className="w-full mt-2">
                  <SelectValue placeholder="Pick a result">
                    {selectedMember
                      ? `${selectedMember.firstname} ${selectedMember.lastname}`
                      : "Pick a result"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.firstname} {m.lastname}
                      {m.phone ? ` · ${m.phone}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v ?? "trial")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="comp-pass-reason-detail">
              Reason detail (optional)
            </Label>
            <Textarea
              id="comp-pass-reason-detail"
              value={reasonDetail}
              onChange={(e) => setReasonDetail(e.target.value)}
              rows={2}
            />
          </div>

          <div>
            <Label htmlFor="comp-pass-expires-at">Expires at</Label>
            <Input
              id="comp-pass-expires-at"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
            {expiresAt && computedDays > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                ≈ {computedDays} day{computedDays === 1 ? "" : "s"} from now.
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="comp-pass-notes">Notes (optional)</Label>
            <Textarea
              id="comp-pass-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {requiresApproval && (
            <div>
              <Label>Approver</Label>
              <Select
                value={approverId}
                onValueChange={(v) => setApproverId(v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select approver">
                    {approverId
                      ? (() => {
                          const a = admins.find(
                            (x) => String(x.id) === approverId
                          );
                          return a
                            ? `${a.firstname} ${a.lastname}`
                            : "Select approver";
                        })()
                      : "Select approver"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {admins.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.firstname} {a.lastname}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Admin approval required for comp passes longer than{" "}
                {APPROVAL_DAYS_THRESHOLD} days.
              </p>
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Issuing…" : "Issue Comp Pass"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
