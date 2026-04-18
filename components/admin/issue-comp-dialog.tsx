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
import { issueCompAction } from "@/lib/actions/comp";
import { searchMembers, getActivePlans } from "@/lib/actions/renewals";
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

type Plan = {
  id: number;
  name: string;
  expireDays: number;
  price: number;
};

type Worker = {
  id: number;
  firstname: string;
  lastname: string;
  role: string;
};

export function IssueCompDialog({
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

  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");

  const [admins, setAdmins] = useState<Worker[]>([]);
  const [reason, setReason] = useState<string>("trial");
  const [reasonDetail, setReasonDetail] = useState("");
  const [days, setDays] = useState<string>("");
  const [approverId, setApproverId] = useState<string>("");

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setMemberQuery("");
    setMembers([]);
    setSelectedMemberId("");
    setSelectedPlanId("");
    setReason("trial");
    setReasonDetail("");
    setDays("");
    setApproverId("");
  }, [open]);

  // Load plans + admin list when opened.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [p, w] = await Promise.all([getActivePlans(), getWorkers()]);
      if (cancelled) return;
      setPlans(
        (p as Plan[]).map((pl) => ({
          id: pl.id,
          name: pl.name,
          expireDays: pl.expireDays,
          price: Number(pl.price),
        }))
      );
      const ws = (w as Worker[]) ?? [];
      setAdmins(ws.filter((x) => x.role === "admin"));
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Member search (debounced).
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

  // Default `days` to plan's expireDays when plan changes.
  useEffect(() => {
    if (!selectedPlanId) return;
    const plan = plans.find((p) => String(p.id) === selectedPlanId);
    if (plan && !days) {
      setDays(String(plan.expireDays));
    }
  }, [selectedPlanId, plans, days]);

  const effectiveDays = useMemo(() => {
    const n = parseInt(days, 10);
    if (Number.isFinite(n) && n > 0) return n;
    const plan = plans.find((p) => String(p.id) === selectedPlanId);
    return plan?.expireDays ?? 0;
  }, [days, plans, selectedPlanId]);

  const requiresApproval = effectiveDays > APPROVAL_DAYS_THRESHOLD;

  const selectedMember = useMemo(
    () => members.find((m) => String(m.id) === selectedMemberId),
    [members, selectedMemberId]
  );

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const userId = parseInt(selectedMemberId, 10);
    const planId = parseInt(selectedPlanId, 10);
    if (!Number.isFinite(userId)) {
      setError("Please select a member");
      return;
    }
    if (!Number.isFinite(planId)) {
      setError("Please select a plan");
      return;
    }
    if (requiresApproval && !approverId) {
      setError("Approver required for comps longer than 7 days");
      return;
    }

    startTransition(async () => {
      const res = await issueCompAction({
        userId,
        planId,
        reason: reason as Parameters<typeof issueCompAction>[0]["reason"],
        reasonDetail: reasonDetail.trim() || undefined,
        days: effectiveDays || undefined,
        approvedById: approverId ? parseInt(approverId, 10) : undefined,
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
          <DialogTitle>Issue Comp</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="comp-member-search">Member</Label>
            <Input
              id="comp-member-search"
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
            <Label>Plan</Label>
            <Select
              value={selectedPlanId}
              onValueChange={(v) => setSelectedPlanId(v ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select plan">
                  {selectedPlanId
                    ? plans.find((p) => String(p.id) === selectedPlanId)?.name ??
                      "Select plan"
                    : "Select plan"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name} · {p.expireDays}d · ₹{p.price}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Label htmlFor="comp-reason-detail">Reason detail (optional)</Label>
            <Textarea
              id="comp-reason-detail"
              value={reasonDetail}
              onChange={(e) => setReasonDetail(e.target.value)}
              rows={2}
              placeholder="Context for this comp…"
            />
          </div>

          <div>
            <Label htmlFor="comp-days">Days</Label>
            <Input
              id="comp-days"
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="Defaults to plan duration"
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
                Admin approval required for comps longer than{" "}
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
              {isPending ? "Issuing…" : "Issue Comp"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
