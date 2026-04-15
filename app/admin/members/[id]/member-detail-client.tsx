"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateMember, toggleMemberActive, cancelMembership } from "@/lib/actions/members";
import { resetMemberPassword } from "@/lib/actions/password";
import { freezeMembershipAction, cancelFreezeAction } from "@/lib/actions/freeze";
import { extendMembershipAction } from "@/lib/actions/extension";
import { addMeasurement } from "@/lib/actions/measurements";
import { manualCheckIn } from "@/lib/actions/attendance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { AlertTriangle, ClipboardCheck, MessageCircle } from "lucide-react";

type LocationOption = {
  id: number;
  name: string;
};

type FreezeData = {
  id: number;
  freezeStart: string;
  freezeEnd: string;
  reason: string | null;
  status: string;
  daysAdded: number;
};

type ExtensionData = {
  id: number;
  daysAdded: number;
  reason: string;
  originalExpiry: string;
  newExpiry: string;
  createdAt: string;
};

type PaymentData = {
  id: number;
  date: string;
  planName: string;
  amount: number;
  paymentMode: string;
  upiReference: string | null;
  invoiceNumber: string | null;
  collectedBy: string;
};

type MeasurementData = {
  id: number;
  date: string;
  weight: number | null;
  height: number | null;
  bmi: number | null;
  chest: number | null;
  waist: number | null;
  hips: number | null;
  biceps: number | null;
  notes: string | null;
};

type PlanOption = {
  id: number;
  name: string;
  expireDays: number;
  price: number;
};

type AnomalyData = {
  hasAnomaly: boolean;
  message: string | null;
  avgVisitsPerWeek: number;
  recentVisitsPerWeek: number;
  daysSinceLastVisit: number | null;
};

type MemberData = {
  id: number;
  firstname: string;
  lastname: string;
  email: string;
  phone: string | null;
  gender: string | null;
  isActive: boolean;
  createdAt: string;
  location: { id: number; name: string } | null;
  memberTickets: {
    id: number;
    buyDate: string;
    expireDate: string;
    plan: { id: number; name: string; price: number; expireDays: number };
    status: string;
  }[];
  attendanceLogs: {
    id: number;
    attendanceDate: string;
    checkIn: string;
    checkOut: string | null;
    source: string;
    location: { name: string };
  }[];
  freezes: FreezeData[];
  extensions: ExtensionData[];
  payments: PaymentData[];
  measurements: MeasurementData[];
};

function fmt(date: string) {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(date: string) {
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

type ChurnRiskData = {
  score: number;
  level: "low" | "medium" | "high";
  reason: string;
};

type SatisfactionScoreData = {
  score: number;
  riskLevel: "low" | "medium" | "high";
  breakdown: {
    attendance: { score: number; visits: number; expected: number };
    payment: { score: number; onTime: number; total: number };
    feedback: { score: number; avgRating: number; count: number };
    tenure: { score: number; months: number };
    engagement: { score: number; classBookings: number; facilityBookings: number };
  };
};

const riskVariantMap: Record<string, "active" | "expiring" | "destructive"> = {
  low: "active",
  medium: "expiring",
  high: "destructive",
};

export function MemberDetailClient({
  member,
  locations,
  plans = [],
  anomaly,
  churnRisk,
  satisfactionScore,
}: {
  member: MemberData;
  locations: LocationOption[];
  plans?: PlanOption[];
  anomaly?: AnomalyData;
  churnRisk?: ChurnRiskData;
  satisfactionScore?: SatisfactionScoreData;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendError, setExtendError] = useState("");
  const [extendSuccess, setExtendSuccess] = useState("");
  const [measureOpen, setMeasureOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [freezeError, setFreezeError] = useState("");
  const [selectedGender, setSelectedGender] = useState(member.gender ?? "");
  const [selectedLocationId, setSelectedLocationId] = useState(
    member.location ? String(member.location.id) : ""
  );
  const [isPending, startTransition] = useTransition();
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [resetPwMsg, setResetPwMsg] = useState("");
  const [changePlanOpen, setChangePlanOpen] = useState(false);
  const [changePlanMsg, setChangePlanMsg] = useState("");
  const [selectedNewPlanId, setSelectedNewPlanId] = useState("");
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInError, setCheckInError] = useState("");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find active ticket (not expired, not cancelled)
  const activeTicket = member.memberTickets.find(
    (t) => new Date(t.expireDate) >= today && (t.status ?? "active") !== "cancelled"
  );

  const activeFreezes = member.freezes.filter((f) => f.status === "active");

  // Days until expiry
  const expiryBadge = (() => {
    if (!activeTicket) return { label: "No active plan", variant: "secondary" as const };
    const expDate = new Date(activeTicket.expireDate);
    expDate.setHours(0, 0, 0, 0);
    const diffMs = expDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { label: `Expired ${Math.abs(diffDays)} days ago`, variant: "destructive" as const };
    if (diffDays < 7) return { label: `Expires in ${diffDays} days`, variant: "destructive" as const };
    if (diffDays < 30) return { label: `Expires in ${diffDays} days`, variant: "expiring" as const };
    return { label: `Expires in ${diffDays} days`, variant: "secondary" as const };
  })();

  // Lifetime value
  const lifetimeValue = member.payments.reduce((sum, p) => sum + p.amount, 0);

  // Attendance this month
  const now = new Date();
  const visitsThisMonth = member.attendanceLogs.filter((l) => {
    const d = new Date(l.checkIn);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const handleCheckIn = async () => {
    const locationId = member.location?.id;
    if (!locationId) {
      setCheckInError("No location assigned");
      return;
    }
    setCheckInError("");
    const result = await manualCheckIn(member.id, locationId);
    if (result.success) {
      setCheckedIn(true);
      setTimeout(() => setCheckedIn(false), 3000);
      router.refresh();
    } else {
      setCheckInError(result.error || "Check-in failed");
    }
  };

  const handleEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const result = await updateMember(member.id, {
      firstname: fd.get("firstname") as string,
      lastname: fd.get("lastname") as string,
      email: fd.get("email") as string,
      phone: (fd.get("phone") as string) || undefined,
      gender: selectedGender || undefined,
      locationId: selectedLocationId ? parseInt(selectedLocationId, 10) : null,
    });
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setEditOpen(false);
    router.refresh();
  };

  const handleFreeze = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeTicket) return;
    const fd = new FormData(e.currentTarget);
    const result = await freezeMembershipAction(
      member.id,
      activeTicket.id,
      fd.get("freezeStart") as string,
      fd.get("freezeEnd") as string,
      (fd.get("reason") as string) || undefined
    );
    if ("error" in result) {
      setFreezeError(result.error || "Failed to freeze");
      return;
    }
    setFreezeError("");
    setFreezeOpen(false);
    router.refresh();
  };

  const handleCancelFreeze = (freezeId: number) => {
    startTransition(async () => {
      await cancelFreezeAction(freezeId, member.id);
      router.refresh();
    });
  };

  const handleExtend = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeTicket) return;
    const fd = new FormData(e.currentTarget);
    const daysToAdd = parseInt(fd.get("daysToAdd") as string, 10);
    const reason = (fd.get("reason") as string).trim();
    if (!daysToAdd || daysToAdd <= 0) {
      setExtendError("Days must be a positive number");
      return;
    }
    if (!reason) {
      setExtendError("Reason is required");
      return;
    }
    const result = await extendMembershipAction({
      userId: member.id,
      memberTicketId: activeTicket.id,
      daysToAdd,
      reason,
    });
    if (!result.success) {
      setExtendError(result.error || "Failed to extend");
      return;
    }
    setExtendError("");
    setExtendSuccess(`Extended by ${daysToAdd} days`);
    setTimeout(() => {
      setExtendOpen(false);
      setExtendSuccess("");
      router.refresh();
    }, 1500);
  };

  const handleAddMeasurement = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const toNum = (key: string) => {
      const v = fd.get(key) as string;
      return v ? parseFloat(v) : undefined;
    };
    await addMeasurement(member.id, {
      date: fd.get("date") as string,
      weight: toNum("weight"),
      height: toNum("height"),
      chest: toNum("chest"),
      waist: toNum("waist"),
      hips: toNum("hips"),
      biceps: toNum("biceps"),
      notes: (fd.get("notes") as string) || undefined,
    });
    setMeasureOpen(false);
    router.refresh();
  };

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const newPassword = fd.get("newPassword") as string;
    const result = await resetMemberPassword(member.id, newPassword);
    if (result.errors) {
      setResetPwMsg(result.errors.password || "Error");
      return;
    }
    setResetPwMsg("Password reset successfully");
    setTimeout(() => { setResetPwOpen(false); setResetPwMsg(""); }, 1500);
  };

  const handleResetToPhone = async () => {
    if (!member.phone) {
      setResetPwMsg("Member has no phone number");
      return;
    }
    const result = await resetMemberPassword(member.id, member.phone);
    if (result.errors) {
      setResetPwMsg(result.errors.password || "Error");
      return;
    }
    setResetPwMsg("Password reset to phone number");
    setTimeout(() => { setResetPwOpen(false); setResetPwMsg(""); }, 1500);
  };

  // Calculate plan change credit
  const currentPlan = activeTicket?.plan;
  const selectedPlan = plans.find((p) => p.id === parseInt(selectedNewPlanId));
  let planChangeCredit = 0;
  let planChangeAmount = 0;
  if (activeTicket && currentPlan && selectedPlan) {
    const expDate = new Date(activeTicket.expireDate);
    expDate.setHours(0, 0, 0, 0);
    const buyDate = new Date(activeTicket.buyDate);
    buyDate.setHours(0, 0, 0, 0);
    const totalDays = Math.max(1, Math.ceil((expDate.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24)));
    const remainingDays = Math.max(0, Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
    planChangeCredit = Math.round((remainingDays / totalDays) * currentPlan.price);
    planChangeAmount = Math.max(0, selectedPlan.price - planChangeCredit);
  }

  const handleChangePlan = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeTicket || !selectedPlan) return;
    const fd = new FormData(e.currentTarget);
    setChangePlanMsg("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/plan-change", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: member.id,
            currentTicketId: activeTicket.id,
            newPlanId: selectedPlan.id,
            locationId: member.location?.id ?? 1,
            paymentMode: fd.get("paymentMode") as string,
            upiRef: (fd.get("upiRef") as string) || undefined,
          }),
        });
        const data = await res.json();
        if (data.success) {
          setChangePlanMsg("Plan changed successfully");
          setTimeout(() => { setChangePlanOpen(false); setChangePlanMsg(""); router.refresh(); }, 1500);
        } else {
          setChangePlanMsg(data.error || "Failed to change plan");
        }
      } catch {
        setChangePlanMsg("Network error");
      }
    });
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {!member.isActive && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium">This member is deactivated</p>
          <p className="text-muted-foreground">They cannot log in or check in. Reactivate from More Actions.</p>
        </div>
      )}
      {anomaly?.hasAnomaly && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-2 text-sm flex items-center gap-2">
          <AlertTriangle className="size-4 text-yellow-600 shrink-0" />
          <span className="text-yellow-700 dark:text-yellow-400">{anomaly.message}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 sm:gap-4">
        <Link href="/admin/members">
          <Button variant="outline" size="sm">
            Back
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">
          {member.firstname} {member.lastname}
        </h1>
        {!member.isActive && <Badge variant="destructive">Inactive</Badge>}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger render={<Button variant="outline" size="sm" />}>
            Edit
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Member</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleEdit} className="space-y-3">
              <div>
                <Label htmlFor="edit-firstname">First Name *</Label>
                <Input
                  id="edit-firstname"
                  name="firstname"
                  defaultValue={member.firstname}
                  required
                />
                {errors.firstname && (
                  <p className="text-xs text-destructive mt-1">{errors.firstname}</p>
                )}
              </div>
              <div>
                <Label htmlFor="edit-lastname">Last Name *</Label>
                <Input
                  id="edit-lastname"
                  name="lastname"
                  defaultValue={member.lastname}
                  required
                />
                {errors.lastname && (
                  <p className="text-xs text-destructive mt-1">{errors.lastname}</p>
                )}
              </div>
              <div>
                <Label htmlFor="edit-email">Email *</Label>
                <Input
                  id="edit-email"
                  name="email"
                  type="email"
                  defaultValue={member.email}
                  required
                />
                {errors.email && (
                  <p className="text-xs text-destructive mt-1">{errors.email}</p>
                )}
              </div>
              <div>
                <Label htmlFor="edit-phone">Phone</Label>
                <Input
                  id="edit-phone"
                  name="phone"
                  defaultValue={member.phone ?? ""}
                />
              </div>
              <div>
                <Label>Gender</Label>
                <Select value={selectedGender} onValueChange={(v) => setSelectedGender(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Location</Label>
                <Select value={selectedLocationId} onValueChange={(v) => setSelectedLocationId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select location">{selectedLocationId ? locations.find((l) => String(l.id) === selectedLocationId)?.name ?? "Select location" : "Select location"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={String(loc.id)}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="submit">Save Changes</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Link href={`/admin/renewals?userId=${member.id}`}>
          <Button size="sm">Renew Plan</Button>
        </Link>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCheckIn}
          disabled={checkedIn}
        >
          <ClipboardCheck className="h-4 w-4 mr-1" />
          {checkedIn ? "Checked in!" : "Check-in"}
        </Button>
        {checkInError && <span className="text-xs text-destructive">{checkInError}</span>}
        {member.phone && (
          <a
            href={`https://wa.me/${member.phone.replace(/\D/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm">
              <MessageCircle className="h-4 w-4 mr-1" />
              WhatsApp
            </Button>
          </a>
        )}
        <Badge variant={expiryBadge.variant}>{expiryBadge.label}</Badge>
        {churnRisk && (
          <Badge variant={riskVariantMap[churnRisk.level]} title={churnRisk.reason}>
            Risk: {churnRisk.level.charAt(0).toUpperCase() + churnRisk.level.slice(1)}
          </Badge>
        )}
        {satisfactionScore && (
          <Badge
            variant="secondary"
            title={`Attendance: ${satisfactionScore.breakdown.attendance.score}, Payment: ${satisfactionScore.breakdown.payment.score}, Feedback: ${satisfactionScore.breakdown.feedback.score}, Tenure: ${satisfactionScore.breakdown.tenure.score}, Engagement: ${satisfactionScore.breakdown.engagement.score}`}
          >
            <span
              className={
                satisfactionScore.score > 70
                  ? "text-green-600 dark:text-green-400"
                  : satisfactionScore.score >= 40
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-red-600 dark:text-red-400"
              }
            >
              Satisfaction: {satisfactionScore.score}
            </span>
          </Badge>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            More Actions
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setResetPwOpen(true)}>
              Reset Password
            </DropdownMenuItem>
            {activeTicket && plans.length > 0 && (
              <DropdownMenuItem onClick={() => setChangePlanOpen(true)}>
                Change Plan
              </DropdownMenuItem>
            )}
            {activeTicket && activeFreezes.length === 0 && (
              <DropdownMenuItem onClick={() => setFreezeOpen(true)}>
                Freeze Membership
              </DropdownMenuItem>
            )}
            {activeTicket && (
              <DropdownMenuItem onClick={() => setExtendOpen(true)}>
                Extend Membership
              </DropdownMenuItem>
            )}
            {activeTicket && (
              <DropdownMenuItem
                onClick={async () => {
                  if (!confirm("Cancel this membership? This cannot be undone.")) return;
                  const res = await cancelMembership(activeTicket.id);
                  if (res.success) router.refresh();
                  else alert(res.error);
                }}
              >
                Cancel Membership
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={async () => {
                const action = member.isActive ? "deactivate" : "reactivate";
                if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} this member?`)) return;
                const res = await toggleMemberActive(member.id);
                if (res.success) router.refresh();
                else alert(res.error);
              }}
            >
              {member.isActive ? "Deactivate Member" : "Reactivate Member"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Reset Password Dialog */}
        <Dialog open={resetPwOpen} onOpenChange={(open) => { setResetPwOpen(open); if (!open) setResetPwMsg(""); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Reset Password</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
                <Label htmlFor="newPassword">New Password</Label>
                <Input id="newPassword" name="newPassword" type="password" minLength={6} required />
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm">Set Password</Button>
                {member.phone && (
                  <Button type="button" variant="outline" size="sm" onClick={handleResetToPhone}>
                    Reset to Phone Number
                  </Button>
                )}
              </div>
              {resetPwMsg && (
                <p className={`text-xs ${resetPwMsg.includes("success") || resetPwMsg.includes("phone") ? "text-status-active-foreground" : "text-destructive"}`}>
                  {resetPwMsg}
                </p>
              )}
            </form>
          </DialogContent>
        </Dialog>
        {/* Change Plan Dialog */}
        {activeTicket && plans.length > 0 && (
          <Dialog open={changePlanOpen} onOpenChange={(open) => { setChangePlanOpen(open); if (!open) { setChangePlanMsg(""); setSelectedNewPlanId(""); } }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Change Plan</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleChangePlan} className="space-y-3">
                <div className="text-sm space-y-1">
                  <p>Current Plan: <strong>{currentPlan?.name}</strong> ({inr.format(currentPlan?.price ?? 0)})</p>
                  <p>Expires: {fmt(activeTicket.expireDate)}</p>
                </div>
                <div>
                  <Label>New Plan</Label>
                  <Select value={selectedNewPlanId} onValueChange={(v) => setSelectedNewPlanId(v ?? "")}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select new plan" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans.filter((p) => p.id !== currentPlan?.id).map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name} - {inr.format(p.price)} ({p.expireDays} days)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedPlan && (
                  <div className="text-sm bg-muted p-3 rounded space-y-1">
                    <p>Pro-rata Credit: {inr.format(planChangeCredit)}</p>
                    <p>New Plan Price: {inr.format(selectedPlan.price)}</p>
                    <p className="font-semibold">Amount Due: {inr.format(planChangeAmount)}</p>
                  </div>
                )}
                <div>
                  <Label>Payment Mode</Label>
                  <Select name="paymentMode" defaultValue="cash">
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="upiRef">UPI Reference (optional)</Label>
                  <Input id="upiRef" name="upiRef" />
                </div>
                {changePlanMsg && (
                  <p className={`text-xs ${changePlanMsg.includes("success") ? "text-status-active-foreground" : "text-destructive"}`}>
                    {changePlanMsg}
                  </p>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={!selectedNewPlanId || isPending}>
                    {isPending ? "Processing..." : "Change Plan"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
        {/* Freeze Dialog */}
        {activeTicket && activeFreezes.length === 0 && (
          <Dialog open={freezeOpen} onOpenChange={(open) => { setFreezeOpen(open); if (!open) setFreezeError(""); }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Freeze Membership</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleFreeze} className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Freezing will pause the membership and extend the expiry date by the number of freeze days.
                </p>
                <div>
                  <Label htmlFor="freezeStart">Freeze Start</Label>
                  <Input id="freezeStart" name="freezeStart" type="date" required />
                </div>
                <div>
                  <Label htmlFor="freezeEnd">Freeze End</Label>
                  <Input id="freezeEnd" name="freezeEnd" type="date" required />
                </div>
                <div>
                  <Label htmlFor="reason">Reason (optional)</Label>
                  <Textarea id="reason" name="reason" rows={2} />
                </div>
                {freezeError && (
                  <p className="text-xs text-destructive">{freezeError}</p>
                )}
                <DialogFooter>
                  <Button type="submit">Freeze Membership</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
        {/* Extend Dialog */}
        {activeTicket && (
          <Dialog open={extendOpen} onOpenChange={(open) => { setExtendOpen(open); if (!open) { setExtendError(""); setExtendSuccess(""); } }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Extend Membership</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleExtend} className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Add days to the membership expiry (e.g., gym closed for holidays).
                </p>
                <div>
                  <Label htmlFor="daysToAdd">Days to extend</Label>
                  <Input id="daysToAdd" name="daysToAdd" type="number" min={1} required />
                </div>
                <div>
                  <Label htmlFor="extendReason">Reason</Label>
                  <Textarea id="extendReason" name="reason" rows={2} required />
                </div>
                {extendError && (
                  <p className="text-xs text-destructive">{extendError}</p>
                )}
                {extendSuccess && (
                  <p className="text-xs text-status-active-foreground">{extendSuccess}</p>
                )}
                <DialogFooter>
                  <Button type="submit">Extend Membership</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Active Freeze Banner */}
      {activeFreezes.length > 0 && (
        <Card className="border-status-frozen/50 bg-status-frozen-bg/30">
          <CardHeader>
            <CardTitle className="text-status-frozen-foreground">Membership Frozen</CardTitle>
          </CardHeader>
          <CardContent>
            {activeFreezes.map((f) => (
              <div key={f.id} className="flex items-center justify-between">
                <div className="text-sm">
                  <p>Frozen from {fmt(f.freezeStart)} to {fmt(f.freezeEnd)} ({f.daysAdded} days added to expiry)</p>
                  {f.reason && <p className="text-muted-foreground">Reason: {f.reason}</p>}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleCancelFreeze(f.id)}
                >
                  Cancel Freeze
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm max-w-lg">
            <dt className="text-muted-foreground">Name</dt>
            <dd>
              {member.firstname} {member.lastname}
            </dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd>{member.email}</dd>
            <dt className="text-muted-foreground">Phone</dt>
            <dd>{member.phone ?? "-"}</dd>
            <dt className="text-muted-foreground">Gender</dt>
            <dd>{member.gender ?? "-"}</dd>
            <dt className="text-muted-foreground">Location</dt>
            <dd>{member.location?.name ?? "N/A"}</dd>
            <dt className="text-muted-foreground">Member Since</dt>
            <dd>{fmt(member.createdAt)}</dd>
            <dt className="text-muted-foreground">Lifetime Value</dt>
            <dd>{inr.format(lifetimeValue)}</dd>
            <dt className="text-muted-foreground">Visits This Month</dt>
            <dd>{visitsThisMonth}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Membership History</CardTitle>
        </CardHeader>
        <CardContent>
          {member.memberTickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No memberships</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead className="hidden sm:table-cell">Buy Date</TableHead>
                  <TableHead>Expire Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {member.memberTickets.map((ticket, idx) => {
                  const cancelled = ticket.status === "cancelled";
                  const expired = new Date(ticket.expireDate) < today;
                  const isLatestActive = idx === 0 && !expired && !cancelled;
                  return (
                    <TableRow key={ticket.id}>
                      <TableCell>{ticket.plan.name}</TableCell>
                      <TableCell className="hidden sm:table-cell">{fmt(ticket.buyDate)}</TableCell>
                      <TableCell>{fmt(ticket.expireDate)}</TableCell>
                      <TableCell>
                        {cancelled ? (
                          <Badge variant="destructive">Cancelled</Badge>
                        ) : isLatestActive ? (
                          <Badge variant="active">Active</Badge>
                        ) : (
                          <Badge variant={expired ? "expired" : "secondary"}>
                            {expired ? "Expired" : "Previous"}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Extensions History */}
      {member.extensions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Extensions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Days Added</TableHead>
                  <TableHead className="hidden sm:table-cell">Original Expiry</TableHead>
                  <TableHead className="hidden sm:table-cell">New Expiry</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {member.extensions.map((ext) => (
                  <TableRow key={ext.id}>
                    <TableCell>{fmt(ext.createdAt)}</TableCell>
                    <TableCell>+{ext.daysAdded} days</TableCell>
                    <TableCell className="hidden sm:table-cell">{fmt(ext.originalExpiry)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{fmt(ext.newExpiry)}</TableCell>
                    <TableCell>{ext.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          {member.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="hidden sm:table-cell">Mode</TableHead>
                  <TableHead className="hidden md:table-cell">UPI Ref</TableHead>
                  <TableHead className="hidden md:table-cell">Invoice #</TableHead>
                  <TableHead className="hidden lg:table-cell">Collected By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {member.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{fmt(p.date)}</TableCell>
                    <TableCell>{p.planName}</TableCell>
                    <TableCell>{inr.format(p.amount)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{p.paymentMode}</TableCell>
                    <TableCell className="hidden md:table-cell">{p.upiReference ?? "-"}</TableCell>
                    <TableCell className="hidden md:table-cell">{p.invoiceNumber ?? "-"}</TableCell>
                    <TableCell className="hidden lg:table-cell">{p.collectedBy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Body Measurements */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Body Measurements</CardTitle>
          <Dialog open={measureOpen} onOpenChange={setMeasureOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              Add Measurement
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add Body Measurement</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddMeasurement} className="space-y-3">
                <div>
                  <Label htmlFor="m-date">Date *</Label>
                  <Input id="m-date" name="date" type="date" required defaultValue={new Date().toISOString().split("T")[0]} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="m-weight">Weight (kg)</Label>
                    <Input id="m-weight" name="weight" type="number" step="0.01" />
                  </div>
                  <div>
                    <Label htmlFor="m-height">Height (cm)</Label>
                    <Input id="m-height" name="height" type="number" step="0.01" />
                  </div>
                  <div>
                    <Label htmlFor="m-chest">Chest (cm)</Label>
                    <Input id="m-chest" name="chest" type="number" step="0.01" />
                  </div>
                  <div>
                    <Label htmlFor="m-waist">Waist (cm)</Label>
                    <Input id="m-waist" name="waist" type="number" step="0.01" />
                  </div>
                  <div>
                    <Label htmlFor="m-hips">Hips (cm)</Label>
                    <Input id="m-hips" name="hips" type="number" step="0.01" />
                  </div>
                  <div>
                    <Label htmlFor="m-biceps">Biceps (cm)</Label>
                    <Input id="m-biceps" name="biceps" type="number" step="0.01" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="m-notes">Notes</Label>
                  <Textarea id="m-notes" name="notes" rows={2} />
                </div>
                <DialogFooter>
                  <Button type="submit">Save Measurement</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {member.measurements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No measurements recorded</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Weight</TableHead>
                  <TableHead className="hidden sm:table-cell">Height</TableHead>
                  <TableHead>BMI</TableHead>
                  <TableHead className="hidden md:table-cell">Chest</TableHead>
                  <TableHead className="hidden md:table-cell">Waist</TableHead>
                  <TableHead className="hidden md:table-cell">Hips</TableHead>
                  <TableHead className="hidden md:table-cell">Biceps</TableHead>
                  <TableHead className="hidden lg:table-cell">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {member.measurements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{fmt(m.date)}</TableCell>
                    <TableCell>{m.weight ?? "-"}</TableCell>
                    <TableCell className="hidden sm:table-cell">{m.height ?? "-"}</TableCell>
                    <TableCell>{m.bmi ?? "-"}</TableCell>
                    <TableCell className="hidden md:table-cell">{m.chest ?? "-"}</TableCell>
                    <TableCell className="hidden md:table-cell">{m.waist ?? "-"}</TableCell>
                    <TableCell className="hidden md:table-cell">{m.hips ?? "-"}</TableCell>
                    <TableCell className="hidden md:table-cell">{m.biceps ?? "-"}</TableCell>
                    <TableCell className="hidden lg:table-cell">{m.notes ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Attendance (Last 5)</CardTitle>
        </CardHeader>
        <CardContent>
          {member.attendanceLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attendance logs</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Check In</TableHead>
                  <TableHead className="hidden sm:table-cell">Check Out</TableHead>
                  <TableHead className="hidden sm:table-cell">Location</TableHead>
                  <TableHead className="hidden md:table-cell">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {member.attendanceLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{fmt(log.attendanceDate)}</TableCell>
                    <TableCell>{fmtTime(log.checkIn)}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {log.checkOut ? fmtTime(log.checkOut) : "-"}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{log.location.name}</TableCell>
                    <TableCell className="hidden md:table-cell">{log.source}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
