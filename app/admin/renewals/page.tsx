"use client";

import { useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  searchMembers,
  getActivePlans,
  getActiveLocations,
  submitRenewal,
  getMemberById,
} from "@/lib/actions/renewals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

type Member = {
  id: number;
  firstname: string;
  lastname: string;
  email: string;
  phone: string | null;
  locationId?: number | null;
  memberTickets?: { planId: number }[];
};

type Plan = {
  id: number;
  name: string;
  expireDays: number;
  price: unknown;
  isActive: boolean;
};

type Location = {
  id: number;
  name: string;
  isActive: boolean;
};

type RenewalResult = {
  success?: boolean;
  idempotent?: boolean;
  paymentId?: number;
  invoiceNumber?: string | null;
  newExpiryDate?: Date | string | null;
  error?: string;
};

export default function RenewalsPage() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [planId, setPlanId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [upiReference, setUpiReference] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoResult, setPromoResult] = useState<{
    valid: boolean;
    discount?: number;
    finalPrice?: number;
    error?: string;
  } | null>(null);
  const [result, setResult] = useState<RenewalResult | null>(null);
  const [isPending, startTransition] = useTransition();

  // UPI QR dialog state
  const [qrOpen, setQrOpen] = useState(false);
  const [qrSvg, setQrSvg] = useState("");
  const [qrLoading, setQrLoading] = useState(false);

  useEffect(() => {
    startTransition(async () => {
      const [p, l] = await Promise.all([getActivePlans(), getActiveLocations()]);
      setPlans(p);
      setLocations(l);
      if (l.length > 0) setLocationId(String(l[0].id));

      // Pre-select member from query param
      const preUserId = searchParams.get("userId");
      if (preUserId) {
        const member = await getMemberById(parseInt(preUserId, 10));
        if (member) {
          setSelectedMember(member);
          if (member.locationId) setLocationId(String(member.locationId));
          if (member.memberTickets && member.memberTickets.length > 0) {
            setPlanId(String(member.memberTickets[0].planId));
          }
          // Also allow URL params to override
          const prePlanId = searchParams.get("planId");
          if (prePlanId) setPlanId(prePlanId);
          const preLocId = searchParams.get("locationId");
          if (preLocId) setLocationId(preLocId);
        }
      }
    });
  }, [searchParams]);

  // Debounced search
  useEffect(() => {
    if (search.length < 2) { setMembers([]); return; }
    const timer = setTimeout(async () => {
      const data = await searchMembers(search);
      setMembers(data);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleSelectMember = async (m: Member) => {
    setMembers([]);
    setSearch("");
    setResult(null);
    // Fetch full member data with latest ticket
    const full = await getMemberById(m.id);
    if (full) {
      setSelectedMember(full);
      if (full.locationId) setLocationId(String(full.locationId));
      if (full.memberTickets && full.memberTickets.length > 0) {
        setPlanId(String(full.memberTickets[0].planId));
      }
    } else {
      setSelectedMember(m);
    }
  };

  const getSelectedPlanPrice = (): number => {
    if (!planId) return 0;
    const plan = plans.find((p) => p.id === parseInt(planId, 10));
    return plan ? Number(plan.price) : 0;
  };

  const handleShowQr = async () => {
    if (!selectedMember || !planId) return;
    setQrLoading(true);
    setQrOpen(true);
    try {
      const amount = getSelectedPlanPrice();
      const memberName = `${selectedMember.firstname} ${selectedMember.lastname}`;
      const res = await fetch(
        `/api/upi-qr?amount=${amount}&memberName=${encodeURIComponent(memberName)}`
      );
      if (res.ok) {
        const svg = await res.text();
        setQrSvg(svg);
      } else {
        setQrSvg("");
      }
    } catch {
      setQrSvg("");
    } finally {
      setQrLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMember || !planId || !locationId) return;

    startTransition(async () => {
      const res = await submitRenewal({
        userId: selectedMember.id,
        planId: parseInt(planId, 10),
        locationId: parseInt(locationId, 10),
        paymentMode,
        upiReference: paymentMode === "upi" ? upiReference : undefined,
        promoCode: promoResult?.valid ? promoCode : undefined,
      });
      setResult(res);
    });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Renewals</h1>

      <Card className="max-w-lg mx-auto sm:mx-0">
        <CardHeader>
          <CardTitle>Renew Membership</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Member search */}
            <div className="space-y-2">
              <Label>Member</Label>
              {selectedMember ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="max-w-full truncate">
                    {selectedMember.firstname} {selectedMember.lastname} ({selectedMember.email})
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => { setSelectedMember(null); setResult(null); }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <div className="space-y-1">
                  <Input
                    placeholder="Search by name, email, or phone..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                  />
                  {members.length > 0 && (
                    <div className="border rounded-md divide-y max-h-40 overflow-y-auto">
                      {members.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => handleSelectMember(m)}
                        >
                          {m.firstname} {m.lastname} - {m.email}
                          {m.phone ? ` (${m.phone})` : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Plan */}
            <div className="space-y-2">
              <Label htmlFor="plan">Plan</Label>
              <select
                id="plan"
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
                required
              >
                <option value="">Select plan...</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} - {p.expireDays} days - Rs.{String(p.price)}
                  </option>
                ))}
              </select>
            </div>

            {/* Location */}
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              {locations.length > 1 ? (
                <select
                  id="location"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
                  required
                >
                  <option value="">Select location...</option>
                  {locations.map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.name}
                    </option>
                  ))}
                </select>
              ) : locations.length === 1 ? (
                <span className="flex h-8 items-center text-sm text-muted-foreground">{locations[0].name}</span>
              ) : null}
            </div>

            {/* Promo Code */}
            <div className="space-y-2">
              <Label>Promo Code</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Enter promo code..."
                  value={promoCode}
                  onChange={(e) => { setPromoCode(e.target.value); setPromoResult(null); }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending || !promoCode.trim() || !planId}
                  onClick={() => {
                    startTransition(async () => {
                      const { validatePromoCode } = await import("@/lib/actions/promos");
                      const res = await validatePromoCode(promoCode, parseInt(planId, 10));
                      setPromoResult(res);
                    });
                  }}
                >
                  Apply
                </Button>
              </div>
              {promoResult && (
                <div className="text-sm">
                  {promoResult.valid ? (
                    <div className="space-y-0.5">
                      <p className="text-status-active-foreground">
                        Discount: Rs.{promoResult.discount}
                      </p>
                      <p className="text-muted-foreground">
                        Original: Rs.{getSelectedPlanPrice()} | Final: Rs.{promoResult.finalPrice}
                      </p>
                    </div>
                  ) : (
                    <p className="text-destructive">{promoResult.error}</p>
                  )}
                </div>
              )}
            </div>

            {/* Payment Mode */}
            <div className="space-y-2">
              <Label htmlFor="paymentMode">Payment Mode</Label>
              <select
                id="paymentMode"
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
              </select>
            </div>

            {/* UPI Reference (conditional) */}
            {paymentMode === "upi" && (
              <div className="space-y-2">
                <Label htmlFor="upiRef">UPI Reference</Label>
                <Input
                  id="upiRef"
                  placeholder="UPI transaction ID..."
                  value={upiReference}
                  onChange={(e) => setUpiReference(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleShowQr}
                  disabled={!selectedMember || !planId}
                >
                  Show QR Code
                </Button>
              </div>
            )}

            <Button type="submit" disabled={isPending || !selectedMember || !planId || !locationId}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {isPending ? "Processing..." : "Submit Renewal"}
            </Button>
          </form>

          {/* Result */}
          {result && (
            <div className="mt-4 p-3 border rounded-md space-y-1">
              {result.error ? (
                <p className="text-sm text-destructive">{result.error}</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-status-active-foreground">
                    Renewal {result.idempotent ? "(duplicate detected - returning existing)" : "successful"}
                  </p>
                  {result.paymentId && (
                    <p className="text-sm text-muted-foreground">Payment ID: {result.paymentId}</p>
                  )}
                  {result.invoiceNumber && (
                    <p className="text-sm text-muted-foreground">Invoice: {result.invoiceNumber}</p>
                  )}
                  {result.newExpiryDate && (
                    <p className="text-sm text-muted-foreground">
                      New Expiry: {new Date(result.newExpiryDate).toLocaleDateString("en-IN")}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* UPI QR Code Dialog */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>UPI Payment QR Code</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qrLoading ? (
              <p className="text-sm text-muted-foreground">Generating QR code...</p>
            ) : qrSvg ? (
              <>
                <div
                  className="w-64 h-64"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
                <p className="text-sm text-muted-foreground text-center">
                  Ask the member to scan this QR code with any UPI app.
                  <br />
                  Amount: Rs. {getSelectedPlanPrice()}
                </p>
              </>
            ) : (
              <p className="text-sm text-destructive">
                Failed to generate QR code. Make sure GYM_UPI_VPA is configured.
              </p>
            )}
          </div>
          <DialogFooter showCloseButton>
            <Button
              variant="default"
              onClick={() => {
                setQrOpen(false);
                // Focus the UPI reference input after closing
                const el = document.getElementById("upiRef");
                if (el) el.focus();
              }}
            >
              Payment Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
