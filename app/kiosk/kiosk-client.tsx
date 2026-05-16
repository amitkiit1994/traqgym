"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";
import { GymBrand } from "@/components/gym-brand";

function KioskInner() {
  const searchParams = useSearchParams();
  const locationId = searchParams.get("locationId") || "1";

  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [locationName, setLocationName] = useState<string | null>(null);
  const [memberName, setMemberName] = useState("");
  const [checkInTime, setCheckInTime] = useState("");
  const [membershipStatus, setMembershipStatus] = useState<string | null>(null);
  const [expiryDate, setExpiryDate] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setPhone("");
    setPhoneError("");
    setStatus("idle");
    setMessage("");
    setMemberName("");
    setCheckInTime("");
    setMembershipStatus(null);
    setExpiryDate(null);
  }, []);

  // Read location name from URL param
  useEffect(() => {
    const name = searchParams.get("locationName");
    if (name) setLocationName(decodeURIComponent(name));
  }, [searchParams]);

  const validatePhone = (value: string): boolean => {
    const digits = value.replace(/\s/g, "");
    if (digits.length !== 10) {
      setPhoneError("Phone number must be 10 digits");
      return false;
    }
    if (!/^[6-9]\d{9}$/.test(digits)) {
      setPhoneError("Invalid Indian phone number (must start with 6-9)");
      return false;
    }
    setPhoneError("");
    return true;
  };

  useEffect(() => {
    if (status === "success" || status === "error") {
      const timer = setTimeout(resetForm, 8000);
      return () => clearTimeout(timer);
    }
  }, [status, resetForm]);

  const handleCheckIn = async () => {
    if (!phone.trim()) return;
    if (!validatePhone(phone.trim())) return;
    setStatus("loading");

    try {
      const res = await fetch("/api/kiosk/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), locationId: parseInt(locationId, 10) }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setStatus("success");
        setMemberName(data.memberName);
        setCheckInTime(data.checkInTime);
        setMembershipStatus(data.membershipStatus || null);
        setExpiryDate(data.expiryDate || null);
        setMessage(data.existing ? "Already checked in today" : "");
      } else {
        setStatus("error");
        setMessage(data.error || "Check-in failed");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCheckIn();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      <div className="mb-12 text-center">
        <GymBrand size="lg" />
        <p className="text-xl text-muted-foreground mt-2">Member Check-in</p>
        {locationName && (
          <p className="text-sm text-muted-foreground mt-1">{locationName}</p>
        )}
      </div>

      <Card className="w-full max-w-lg">
        <CardContent className="p-8">
          {status === "idle" || status === "loading" ? (
            <div className="space-y-6">
              <div>
                <label className="block text-lg font-medium mb-2">
                  Enter your phone number
                </label>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g. 9876543210"
                  className="text-2xl h-16 text-center"
                  autoFocus
                  disabled={status === "loading"}
                />
              </div>
              {phoneError && (
                <p className="text-sm text-destructive">{phoneError}</p>
              )}
              <Button
                onClick={handleCheckIn}
                disabled={!phone.trim() || status === "loading"}
                className="w-full h-16 text-xl"
                size="lg"
              >
                {status === "loading" ? "Checking in..." : "Check In"}
              </Button>
            </div>
          ) : status === "success" ? (
            <div className="text-center space-y-4 py-4">
              <CheckCircle2 className="mx-auto size-20 text-status-active" />
              <h2 className="text-3xl font-bold">Welcome, {memberName}!</h2>
              <p className="text-xl text-muted-foreground">
                Checked in at {checkInTime}
              </p>
              {membershipStatus === "active" && expiryDate && (() => {
                const daysLeft = Math.ceil(
                  (new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                );
                return (
                  <p className={`text-sm font-medium ${daysLeft <= 7 ? "text-status-expiring-foreground" : "text-status-active-foreground"}`}>
                    {daysLeft <= 7
                      ? `Expiring in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} \u2014 please renew at front desk`
                      : `Active until ${new Date(expiryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}
                  </p>
                );
              })()}
              {membershipStatus === "grace" && (
                <p className="text-sm font-medium text-status-grace-foreground">
                  Membership expired &mdash; grace period active, please renew soon
                </p>
              )}
              {membershipStatus === "expired" && (
                <p className="text-sm font-medium text-status-expired-foreground">
                  Membership expired &mdash; please renew
                </p>
              )}
              {message && (
                <p className="text-sm text-muted-foreground">{message}</p>
              )}
            </div>
          ) : (
            <div className="text-center space-y-4 py-4">
              <XCircle className="mx-auto size-20 text-destructive" />
              <h2 className="text-2xl font-semibold text-destructive">{message}</h2>
              <p className="text-muted-foreground">Please try again</p>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-8 text-sm text-muted-foreground">
        This kiosk will reset automatically
      </p>
    </div>
  );
}

export default function KioskClient() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p>Loading...</p></div>}>
      <KioskInner />
    </Suspense>
  );
}
