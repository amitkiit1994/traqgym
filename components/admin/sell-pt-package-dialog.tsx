"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type Trainer = {
  id: number;
  firstname: string;
  lastname: string;
  role: string;
  isExternal: boolean;
  defaultGymCutPct: number;
  ownTrainerCutPct: number;
};

type Member = {
  id: number;
  firstname: string;
  lastname: string;
  phone: string | null;
};

export function SellPtPackageDialog({
  open,
  onOpenChange,
  trainers,
  onSold,
  initialMember,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trainers: Trainer[];
  onSold?: () => void;
  initialMember?: Member;
}) {
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(initialMember ?? null);
  const [trainerId, setTrainerId] = useState<number | "">(trainers[0]?.id ?? "");
  const [sessionsTotal, setSessionsTotal] = useState<string>("8");
  const [pricePerSession, setPricePerSession] = useState<string>("500");
  const [trainerSharePct, setTrainerSharePct] = useState<string>("");
  const [paymentMode, setPaymentMode] = useState<string>("cash");
  const [paidAmount, setPaidAmount] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedMember(initialMember ?? null);
      setMemberQuery("");
      setMemberResults([]);
      setTrainerId(trainers[0]?.id ?? "");
      setSessionsTotal("8");
      setPricePerSession("500");
      setTrainerSharePct("");
      setPaymentMode("cash");
      setPaidAmount("");
      setExpiresAt("");
      setError("");
    }
  }, [open, initialMember, trainers]);

  // Live total
  const total =
    Number(sessionsTotal || 0) * Number(pricePerSession || 0);

  // Default paidAmount to full total on first compute
  useEffect(() => {
    if (paidAmount === "" && total > 0) {
      setPaidAmount(String(total));
    }
  }, [total, paidAmount]);

  // Member search
  useEffect(() => {
    if (memberQuery.length < 2) {
      setMemberResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const { searchMembersForPtAction } = await import("@/lib/actions/pt");
      const results = await searchMembersForPtAction(memberQuery);
      setMemberResults(results as Member[]);
    }, 300);
    return () => clearTimeout(timer);
  }, [memberQuery]);

  const selectedTrainer = trainers.find((t) => t.id === trainerId);

  const handleSubmit = () => {
    setError("");
    if (!selectedMember) {
      setError("Select a member");
      return;
    }
    if (!trainerId) {
      setError("Select a trainer");
      return;
    }
    const sessions = Number(sessionsTotal);
    if (!Number.isFinite(sessions) || sessions <= 0) {
      setError("Sessions must be a positive integer");
      return;
    }
    const price = Number(pricePerSession);
    if (!Number.isFinite(price) || price < 0) {
      setError("Price per session must be >= 0");
      return;
    }
    const paid = Number(paidAmount);
    if (!Number.isFinite(paid) || paid < 0) {
      setError("Paid amount must be >= 0");
      return;
    }
    const sharePct = trainerSharePct === "" ? undefined : Number(trainerSharePct);
    if (sharePct !== undefined && (sharePct < 0 || sharePct > 100)) {
      setError("Trainer share must be 0–100");
      return;
    }

    startTransition(async () => {
      const { sellPtPackageAction } = await import("@/lib/actions/pt");
      const result = await sellPtPackageAction({
        userId: selectedMember.id,
        trainerId: Number(trainerId),
        sessionsTotal: sessions,
        pricePerSession: price,
        paymentMode,
        paidAmount: paid,
        trainerSharePct: sharePct,
        expiresAt: expiresAt || undefined,
      });
      if (result.success) {
        onOpenChange(false);
        onSold?.();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sell PT Package</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Member selection */}
          <div>
            <Label>Member</Label>
            {selectedMember ? (
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline">
                  {selectedMember.firstname} {selectedMember.lastname}
                  {selectedMember.phone ? ` (${selectedMember.phone})` : ""}
                </Badge>
                {!initialMember && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedMember(null);
                      setMemberQuery("");
                    }}
                  >
                    Change
                  </Button>
                )}
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="Search by name or phone..."
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  className="mt-1"
                />
                {memberResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                    {memberResults.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                        onClick={() => {
                          setSelectedMember(m);
                          setMemberResults([]);
                          setMemberQuery("");
                        }}
                      >
                        {m.firstname} {m.lastname}
                        {m.phone && (
                          <span className="ml-2 text-muted-foreground">
                            {m.phone}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Trainer */}
          <div>
            <Label>Trainer</Label>
            <select
              value={trainerId}
              onChange={(e) =>
                setTrainerId(e.target.value ? Number(e.target.value) : "")
              }
              className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select trainer...</option>
              {trainers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.firstname} {t.lastname} ({t.role})
                  {t.isExternal ? " — external" : ""}
                </option>
              ))}
            </select>
            {selectedTrainer && (
              <p className="mt-1 text-xs text-muted-foreground">
                Default share: {selectedTrainer.ownTrainerCutPct}%
                {selectedTrainer.isExternal
                  ? ` (gym takes ${selectedTrainer.defaultGymCutPct}%)`
                  : ""}
              </p>
            )}
          </div>

          {/* Sessions / price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Sessions count</Label>
              <Input
                type="number"
                min={1}
                value={sessionsTotal}
                onChange={(e) => setSessionsTotal(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Price per session (₹)</Label>
              <Input
                type="number"
                min={0}
                value={pricePerSession}
                onChange={(e) => setPricePerSession(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          <div className="text-sm">
            Total: <span className="font-semibold">₹{total.toLocaleString("en-IN")}</span>
          </div>

          {/* Trainer share */}
          <div>
            <Label>Trainer share % (override)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={trainerSharePct}
              onChange={(e) => setTrainerSharePct(e.target.value)}
              placeholder={`Leave blank to use trainer default (${selectedTrainer?.ownTrainerCutPct ?? 0}%)`}
              className="mt-1"
            />
          </div>

          {/* Payment */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Payment mode</Label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
            <div>
              <Label>Paid amount (₹)</Label>
              <Input
                type="number"
                min={0}
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          {/* Expires */}
          <div>
            <Label>Expires at (optional)</Label>
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving..." : "Sell Package"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
