"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import Image from "next/image";

async function loadSettings() {
  const res = await fetch("/api/admin/settings");
  if (!res.ok) throw new Error("Failed to load settings");
  return res.json();
}

async function saveSettings(settings: Record<string, string>) {
  const res = await fetch("/api/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error("Failed to save settings");
  return res.json();
}

const PAYMENT_MODE_OPTIONS = [
  { key: "cash", label: "Cash" },
  { key: "upi", label: "UPI" },
  { key: "card", label: "Card" },
  { key: "bank_transfer", label: "Bank Transfer" },
];

export default function SettingsPage() {
  // Branding
  const [gymName, setGymName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [gymAddress, setGymAddress] = useState("");
  const [gymPhone, setGymPhone] = useState("");
  const [gymEmail, setGymEmail] = useState("");
  const [gymState, setGymState] = useState("Maharashtra");
  const [gymGstin, setGymGstin] = useState("");
  const [gymUpiVpa, setGymUpiVpa] = useState("");

  // Financial
  const [gstRate, setGstRate] = useState("18");
  const [registrationFee, setRegistrationFee] = useState("0");
  const [paymentModes, setPaymentModes] = useState<Set<string>>(new Set(["cash", "upi"]));

  // Membership policy
  const [gracePeriod, setGracePeriod] = useState("7");
  const [renewalReminderDays, setRenewalReminderDays] = useState("7,3,1");
  const [maxFreezes, setMaxFreezes] = useState("2");
  const [maxFreezeDays, setMaxFreezeDays] = useState("30");

  // Leave policy
  const [leaveCasualQuota, setLeaveCasualQuota] = useState("12");
  const [leaveSickQuota, setLeaveSickQuota] = useState("6");
  const [leavePersonalQuota, setLeavePersonalQuota] = useState("3");

  // Kiosk
  const [autoCheckout, setAutoCheckout] = useState(true);
  const [checkinCooldown, setCheckinCooldown] = useState("60");

  // Operations (PR 12)
  const [peakHoursStart, setPeakHoursStart] = useState("06:00");
  const [peakHoursEnd, setPeakHoursEnd] = useState("09:00");
  const [lateEntryAfter, setLateEntryAfter] = useState("22:00");
  const [lockerKeyOverdueDays, setLockerKeyOverdueDays] = useState("7");
  const [trainerRatingThreshold, setTrainerRatingThreshold] = useState("3.5");

  // QR Self-Check-in
  const [qrCheckinEnabled, setQrCheckinEnabled] = useState(false);
  const [qrCheckinRateLimitHours, setQrCheckinRateLimitHours] = useState("4");
  const [qrTokenMaxAgeDays, setQrTokenMaxAgeDays] = useState("365");
  const [qrCheckinAllowPhoneOnly, setQrCheckinAllowPhoneOnly] = useState(false);

  // Communication
  const [welcomeMessage, setWelcomeMessage] = useState(true);
  const [birthdayWish, setBirthdayWish] = useState(true);
  const [renewalReminder, setRenewalReminder] = useState(true);
  const [announcementNotify, setAnnouncementNotify] = useState(true);
  const [promoNotify, setPromoNotify] = useState(true);
  const [notificationChannel, setNotificationChannel] = useState("whatsapp");

  // Automation / Cron
  const [cronRenewalReminders, setCronRenewalReminders] = useState(true);
  const [cronAutoCheckout, setCronAutoCheckout] = useState(true);
  const [cronReEngagement, setCronReEngagement] = useState(true);
  const [triggeringCron, setTriggeringCron] = useState<string | null>(null);
  const [cronResult, setCronResult] = useState<string | null>(null);

  // Integrations — MSG91
  const [msg91AuthKey, setMsg91AuthKey] = useState("");
  const [msg91WhatsappNumber, setMsg91WhatsappNumber] = useState("");
  const [msg91SmsFlowId, setMsg91SmsFlowId] = useState("");
  const [msg91SmsSenderId, setMsg91SmsSenderId] = useState("");

  // Integrations — SMTP
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");

  // Integrations — Biometric SDK
  const [biomaxBaseUrl, setBiomaxBaseUrl] = useState("");
  const [biomaxApiKey, setBiomaxApiKey] = useState("");

  // Integration test state
  const [testingChannel, setTestingChannel] = useState<string | null>(null);
  const [testRecipient, setTestRecipient] = useState("");
  const [channelTestResult, setChannelTestResult] = useState<string | null>(null);
  const [testingBiomax, setTestingBiomax] = useState(false);
  const [biomaxTestResult, setBiomaxTestResult] = useState<string | null>(null);

  // Tax & Accounting (Tally + GSTR-1)
  const [gymServiceHsn, setGymServiceHsn] = useState("999723");
  const [gymGstRate, setGymGstRate] = useState("18");
  const [gymGstScheme, setGymGstScheme] = useState("regular");
  const [tallySalesLedger, setTallySalesLedger] = useState("Sales");
  const [tallyCgstLedger, setTallyCgstLedger] = useState("CGST Output");
  const [tallySgstLedger, setTallySgstLedger] = useState("SGST Output");
  const [tallyIgstLedger, setTallyIgstLedger] = useState("IGST Output");

  // Data Lifecycle
  const [dataCleanupEnabled, setDataCleanupEnabled] = useState(true);
  const [followupArchiveDays, setFollowupArchiveDays] = useState("180");
  const [enquiryCloseDays, setEnquiryCloseDays] = useState("120");
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);

  // PR 8: Manager Briefing
  const [gymOwnerName, setGymOwnerName] = useState("Owner");
  const [gymOwnerEmail, setGymOwnerEmail] = useState("");
  const [gymOwnerLang, setGymOwnerLang] = useState("en");
  const [managerBriefingEnabled, setManagerBriefingEnabled] = useState(false);
  const [managerMinSeverity, setManagerMinSeverity] = useState("high");
  const [managerBriefingTopN, setManagerBriefingTopN] = useState("5");
  const [managerBriefingTime, setManagerBriefingTime] = useState("07:00");
  const [sendingTestBriefing, setSendingTestBriefing] = useState(false);
  const [briefingResult, setBriefingResult] = useState<string | null>(null);

  // UI state
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadSettings()
      .then((data) => {
        setGymName(data.gym_name ?? "");
        setLogoUrl(data.gym_logo ?? "");
        setGymAddress(data.gym_address ?? "");
        setGymPhone(data.gym_phone ?? "");
        setGymEmail(data.gym_email ?? "");
        setGymState(data.gym_state ?? "Maharashtra");
        setGymGstin(data.gym_gstin ?? "");
        setGymUpiVpa(data.gym_upi_vpa ?? "");
        setGstRate(data.gst_rate ?? "18");
        setRegistrationFee(data.registration_fee ?? "0");
        setPaymentModes(new Set((data.payment_modes ?? "cash,upi").split(",").filter(Boolean)));
        setGracePeriod(data.grace_period_days ?? "7");
        setRenewalReminderDays(data.renewal_reminder_days ?? "7,3,1");
        setMaxFreezes(data.max_freezes_per_membership ?? "2");
        setMaxFreezeDays(data.max_freeze_days ?? "30");
        setLeaveCasualQuota(data.leave_casual_quota ?? "12");
        setLeaveSickQuota(data.leave_sick_quota ?? "6");
        setLeavePersonalQuota(data.leave_personal_quota ?? "3");
        setAutoCheckout(data.auto_checkout_enabled === "true");
        setCheckinCooldown(data.checkin_cooldown_seconds ?? "60");
        setQrCheckinEnabled(data.qr_checkin_enabled === "true");
        setQrCheckinRateLimitHours(data.qr_checkin_rate_limit_hours ?? "4");
        setQrTokenMaxAgeDays(data.qr_token_max_age_days ?? "365");
        setQrCheckinAllowPhoneOnly(data.qr_checkin_allow_phone_only === "true");
        setWelcomeMessage(data.welcome_message_enabled !== "false");
        setBirthdayWish(data.birthday_wish_enabled === "true");
        setRenewalReminder(data.renewal_reminder_enabled !== "false");
        setAnnouncementNotify(data.announcement_notify_enabled !== "false");
        setPromoNotify(data.promo_notify_enabled !== "false");
        setNotificationChannel(data.notification_channel ?? "whatsapp");
        setCronRenewalReminders(data.cron_renewal_reminders_enabled !== "false");
        setCronAutoCheckout(data.cron_auto_checkout_enabled !== "false");
        setCronReEngagement(data.cron_re_engagement_enabled !== "false");
        // Integrations
        setMsg91AuthKey(data.msg91_auth_key ?? "");
        setMsg91WhatsappNumber(data.msg91_whatsapp_number ?? "");
        setMsg91SmsFlowId(data.msg91_sms_flow_id ?? "");
        setMsg91SmsSenderId(data.msg91_sms_sender_id ?? "");
        setSmtpHost(data.smtp_host ?? "");
        setSmtpPort(data.smtp_port ?? "587");
        setSmtpUser(data.smtp_user ?? "");
        setSmtpPass(data.smtp_pass ?? "");
        setSmtpFrom(data.smtp_from ?? "");
        setBiomaxBaseUrl(data.biomax_sdk_base_url ?? "");
        setBiomaxApiKey(data.biomax_sdk_api_key ?? "");
        setDataCleanupEnabled(data.data_cleanup_enabled !== "false");
        setFollowupArchiveDays(data.followup_auto_archive_days ?? "180");
        setEnquiryCloseDays(data.enquiry_auto_close_days ?? "120");
        setPeakHoursStart(data.peak_hours_start ?? "06:00");
        setPeakHoursEnd(data.peak_hours_end ?? "09:00");
        setLateEntryAfter(data.late_entry_after ?? "22:00");
        setLockerKeyOverdueDays(data.locker_key_overdue_threshold_days ?? "7");
        setTrainerRatingThreshold(data.trainer_rating_threshold ?? "3.5");
        // Tax & Accounting
        setGymServiceHsn(data.gym_service_hsn ?? "999723");
        setGymGstRate(data.gym_gst_rate ?? data.gst_rate ?? "18");
        setGymGstScheme(data.gym_gst_scheme ?? "regular");
        setTallySalesLedger(data.tally_sales_ledger ?? "Sales");
        setTallyCgstLedger(data.tally_cgst_ledger ?? "CGST Output");
        setTallySgstLedger(data.tally_sgst_ledger ?? "SGST Output");
        setTallyIgstLedger(data.tally_igst_ledger ?? "IGST Output");
        // PR 8: Manager Briefing
        setGymOwnerName(data.gym_owner_name ?? "Owner");
        setGymOwnerEmail(data.gym_owner_email ?? "");
        setGymOwnerLang(data.gym_owner_lang ?? "en");
        setManagerBriefingEnabled(data.manager_briefing_enabled === "true");
        setManagerMinSeverity(data.manager_min_severity ?? "high");
        setManagerBriefingTopN(data.manager_briefing_top_n ?? "5");
        setManagerBriefingTime(data.manager_briefing_time ?? "07:00");
      })
      .catch(() => setError("Failed to load settings"));
  }, []);

  const togglePaymentMode = (mode: string) => {
    setPaymentModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      return next;
    });
  };

  const handleSave = () => {
    setSaved(false);
    setError("");
    startTransition(async () => {
      try {
        await saveSettings({
          gym_name: gymName,
          gym_address: gymAddress,
          gym_phone: gymPhone,
          gym_email: gymEmail,
          gym_state: gymState,
          gym_gstin: gymGstin,
          gym_upi_vpa: gymUpiVpa,
          gst_rate: gstRate,
          registration_fee: registrationFee,
          payment_modes: Array.from(paymentModes).join(","),
          grace_period_days: gracePeriod,
          renewal_reminder_days: renewalReminderDays,
          max_freezes_per_membership: maxFreezes,
          max_freeze_days: maxFreezeDays,
          leave_casual_quota: leaveCasualQuota,
          leave_sick_quota: leaveSickQuota,
          leave_personal_quota: leavePersonalQuota,
          auto_checkout_enabled: autoCheckout ? "true" : "false",
          checkin_cooldown_seconds: checkinCooldown,
          qr_checkin_enabled: qrCheckinEnabled ? "true" : "false",
          qr_checkin_rate_limit_hours: qrCheckinRateLimitHours,
          qr_token_max_age_days: qrTokenMaxAgeDays,
          qr_checkin_allow_phone_only: qrCheckinAllowPhoneOnly ? "true" : "false",
          welcome_message_enabled: welcomeMessage ? "true" : "false",
          birthday_wish_enabled: birthdayWish ? "true" : "false",
          renewal_reminder_enabled: renewalReminder ? "true" : "false",
          announcement_notify_enabled: announcementNotify ? "true" : "false",
          promo_notify_enabled: promoNotify ? "true" : "false",
          notification_channel: notificationChannel,
          cron_renewal_reminders_enabled: cronRenewalReminders ? "true" : "false",
          cron_auto_checkout_enabled: cronAutoCheckout ? "true" : "false",
          cron_re_engagement_enabled: cronReEngagement ? "true" : "false",
          // Integrations
          msg91_auth_key: msg91AuthKey,
          msg91_whatsapp_number: msg91WhatsappNumber,
          msg91_sms_flow_id: msg91SmsFlowId,
          msg91_sms_sender_id: msg91SmsSenderId,
          smtp_host: smtpHost,
          smtp_port: smtpPort,
          smtp_user: smtpUser,
          smtp_pass: smtpPass,
          smtp_from: smtpFrom,
          biomax_sdk_base_url: biomaxBaseUrl,
          biomax_sdk_api_key: biomaxApiKey,
          data_cleanup_enabled: dataCleanupEnabled ? "true" : "false",
          followup_auto_archive_days: followupArchiveDays,
          enquiry_auto_close_days: enquiryCloseDays,
          peak_hours_start: peakHoursStart,
          peak_hours_end: peakHoursEnd,
          late_entry_after: lateEntryAfter,
          locker_key_overdue_threshold_days: lockerKeyOverdueDays,
          trainer_rating_threshold: trainerRatingThreshold,
          // Tax & Accounting
          gym_service_hsn: gymServiceHsn,
          gym_gst_rate: gymGstRate,
          gym_gst_scheme: gymGstScheme,
          tally_sales_ledger: tallySalesLedger,
          tally_cgst_ledger: tallyCgstLedger,
          tally_sgst_ledger: tallySgstLedger,
          tally_igst_ledger: tallyIgstLedger,
          // PR 8: Manager Briefing
          gym_owner_name: gymOwnerName,
          gym_owner_email: gymOwnerEmail,
          gym_owner_lang: gymOwnerLang,
          manager_briefing_enabled: managerBriefingEnabled ? "true" : "false",
          manager_min_severity: managerMinSeverity,
          manager_briefing_top_n: managerBriefingTopN,
          manager_briefing_time: managerBriefingTime,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch {
        setError("Failed to save settings");
      }
    });
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      {/* Card 1: Gym Identity */}
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>Gym Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="gym-name">Gym Name</Label>
            <Input
              id="gym-name"
              value={gymName}
              onChange={(e) => setGymName(e.target.value)}
              placeholder={process.env.NEXT_PUBLIC_GYM_NAME || "TraqGym"}
            />
            <p className="text-xs text-muted-foreground">
              Override the gym name displayed across the app
            </p>
          </div>

          <div className="space-y-2">
            <Label>Gym Logo</Label>
            <div className="flex items-center gap-4">
              {logoUrl && (
                <Image
                  src={`${logoUrl}?t=${Date.now()}`}
                  alt="Gym logo"
                  width={64}
                  height={64}
                  className="rounded-lg border object-contain"
                  unoptimized
                />
              )}
              <div className="space-y-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setLogoUploading(true);
                    setError("");
                    try {
                      const formData = new FormData();
                      formData.append("logo", file);
                      const res = await fetch("/api/admin/logo", {
                        method: "POST",
                        body: formData,
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error);
                      setLogoUrl(data.path);
                    } catch (err: any) {
                      setError(err.message || "Failed to upload logo");
                    } finally {
                      setLogoUploading(false);
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={logoUploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {logoUploading ? "Uploading..." : logoUrl ? "Change Logo" : "Upload Logo"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  PNG, JPEG, SVG, or WebP. Max 2MB.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gym-address">Address</Label>
            <textarea
              id="gym-address"
              className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={gymAddress}
              onChange={(e) => setGymAddress(e.target.value)}
              placeholder="Full gym address"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gym-phone">Phone</Label>
            <Input
              id="gym-phone"
              value={gymPhone}
              onChange={(e) => setGymPhone(e.target.value)}
              placeholder="+91 98765 43210"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gym-email">Email</Label>
            <Input
              id="gym-email"
              type="email"
              value={gymEmail}
              onChange={(e) => setGymEmail(e.target.value)}
              placeholder="info@gym.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gym-state">State</Label>
            <Input
              id="gym-state"
              value={gymState}
              onChange={(e) => setGymState(e.target.value)}
              placeholder="Maharashtra"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gym-gstin">GSTIN</Label>
            <Input
              id="gym-gstin"
              value={gymGstin}
              onChange={(e) => setGymGstin(e.target.value)}
              placeholder="27AABCU9603R1ZM"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gym-upi-vpa">UPI VPA</Label>
            <Input
              id="gym-upi-vpa"
              value={gymUpiVpa}
              onChange={(e) => setGymUpiVpa(e.target.value)}
              placeholder="gym@upi"
            />
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Financial */}
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>Financial</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="gst-rate">GST Rate</Label>
            <div className="flex items-center gap-2">
              <Input
                id="gst-rate"
                type="number"
                min="0"
                max="28"
                value={gstRate}
                onChange={(e) => setGstRate(e.target.value)}
                className="max-w-[100px]"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="registration-fee">Registration Fee</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">&#8377;</span>
              <Input
                id="registration-fee"
                type="number"
                min="0"
                value={registrationFee}
                onChange={(e) => setRegistrationFee(e.target.value)}
                className="max-w-[140px]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Payment Modes</Label>
            <div className="space-y-3">
              {PAYMENT_MODE_OPTIONS.map((mode) => (
                <div key={mode.key} className="flex items-center justify-between">
                  <Label className="font-normal">{mode.label}</Label>
                  <Switch
                    checked={paymentModes.has(mode.key)}
                    onCheckedChange={() => togglePaymentMode(mode.key)}
                  />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 3: Membership Policy */}
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>Membership Policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="grace-period">Grace Period (days)</Label>
            <Input
              id="grace-period"
              type="number"
              min="0"
              max="30"
              value={gracePeriod}
              onChange={(e) => setGracePeriod(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Days after expiry before marking member as overdue
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="renewal-reminder">Renewal Reminder Days</Label>
            <Input
              id="renewal-reminder"
              value={renewalReminderDays}
              onChange={(e) => setRenewalReminderDays(e.target.value)}
              placeholder="7,3,1"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated days before expiry to send reminders
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="max-freezes">Max Freezes per Membership</Label>
            <Input
              id="max-freezes"
              type="number"
              min="0"
              max="10"
              value={maxFreezes}
              onChange={(e) => setMaxFreezes(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="max-freeze-days">Max Freeze Days</Label>
            <Input
              id="max-freeze-days"
              type="number"
              min="0"
              max="90"
              value={maxFreezeDays}
              onChange={(e) => setMaxFreezeDays(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Card 4: Leave Policy */}
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>Leave Policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-xs text-muted-foreground">
            Annual leave quota per worker. Balance is computed as quota minus approved leaves in the current year.
          </p>
          <div className="space-y-2">
            <Label htmlFor="leave-casual">Casual Leave (days/year)</Label>
            <Input
              id="leave-casual"
              type="number"
              min="0"
              max="365"
              value={leaveCasualQuota}
              onChange={(e) => setLeaveCasualQuota(e.target.value)}
              className="max-w-[100px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="leave-sick">Sick Leave (days/year)</Label>
            <Input
              id="leave-sick"
              type="number"
              min="0"
              max="365"
              value={leaveSickQuota}
              onChange={(e) => setLeaveSickQuota(e.target.value)}
              className="max-w-[100px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="leave-personal">Personal Leave (days/year)</Label>
            <Input
              id="leave-personal"
              type="number"
              min="0"
              max="365"
              value={leavePersonalQuota}
              onChange={(e) => setLeavePersonalQuota(e.target.value)}
              className="max-w-[100px]"
            />
          </div>
        </CardContent>
      </Card>

      {/* Card 5: Kiosk & Check-in */}
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>Kiosk &amp; Check-in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto-checkout</Label>
              <p className="text-xs text-muted-foreground">
                Automatically check out members at closing time
              </p>
            </div>
            <Switch
              checked={autoCheckout}
              onCheckedChange={setAutoCheckout}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="checkin-cooldown">Check-in Cooldown (seconds)</Label>
            <Input
              id="checkin-cooldown"
              type="number"
              min="10"
              max="300"
              value={checkinCooldown}
              onChange={(e) => setCheckinCooldown(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Minimum seconds between consecutive check-ins for the same member
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Card: Operations (PR 12) */}
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>Operations</CardTitle>
          <p className="text-xs text-muted-foreground">
            Peak hours, late entry, locker key audit and trainer rating thresholds.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="peak-start">Peak hours start (24h)</Label>
              <Input
                id="peak-start"
                placeholder="06:00"
                value={peakHoursStart}
                onChange={(e) => setPeakHoursStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="peak-end">Peak hours end (24h)</Label>
              <Input
                id="peak-end"
                placeholder="09:00"
                value={peakHoursEnd}
                onChange={(e) => setPeakHoursEnd(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="late-entry">Late entry after (24h)</Label>
            <Input
              id="late-entry"
              placeholder="22:00"
              value={lateEntryAfter}
              onChange={(e) => setLateEntryAfter(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Check-ins at or after this time are flagged as late entry.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="locker-overdue">Locker key overdue threshold (days)</Label>
            <Input
              id="locker-overdue"
              type="number"
              min="1"
              value={lockerKeyOverdueDays}
              onChange={(e) => setLockerKeyOverdueDays(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Days past expected return before a key is flagged as overdue.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="trainer-threshold">Trainer rating low threshold</Label>
            <Input
              id="trainer-threshold"
              type="number"
              min="1"
              max="5"
              step="0.1"
              value={trainerRatingThreshold}
              onChange={(e) => setTrainerRatingThreshold(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Average rating below this (over 5+ ratings in 30d) raises an admin insight.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Card 5b: QR Self-Check-in */}
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>QR Self-Check-in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-xs text-muted-foreground">
            Members scan a printed lobby poster with their phone to mark attendance.
            Manage posters in <a href="/admin/settings/qr-checkin" className="underline">QR Check-in</a>.
          </p>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable QR Check-in</Label>
              <p className="text-xs text-muted-foreground">
                Allows members to check in by scanning the lobby QR.
              </p>
            </div>
            <Switch checked={qrCheckinEnabled} onCheckedChange={setQrCheckinEnabled} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qr-rate-hours">Rate limit (hours)</Label>
            <Input
              id="qr-rate-hours"
              type="number"
              min="1"
              max="24"
              value={qrCheckinRateLimitHours}
              onChange={(e) => setQrCheckinRateLimitHours(e.target.value)}
              className="max-w-[100px]"
            />
            <p className="text-xs text-muted-foreground">
              Maximum 1 successful QR check-in per member within this window.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qr-token-days">Token validity (days)</Label>
            <Input
              id="qr-token-days"
              type="number"
              min="1"
              max="3650"
              value={qrTokenMaxAgeDays}
              onChange={(e) => setQrTokenMaxAgeDays(e.target.value)}
              className="max-w-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              Default lifetime baked into newly generated lobby posters.
              Reprint posters after rotating QR_TOKEN_SECRET.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Allow phone-only check-in</Label>
              <p className="text-xs text-muted-foreground">
                Off (recommended): require member sign-in. On: accept just a phone
                number — no OTP yet, so leave off until OTP infra ships.
              </p>
            </div>
            <Switch checked={qrCheckinAllowPhoneOnly} onCheckedChange={setQrCheckinAllowPhoneOnly} />
          </div>
        </CardContent>
      </Card>

      {/* Card 5: Communication */}
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>Communication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="notification-channel">Notification Channel</Label>
            <select
              id="notification-channel"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={notificationChannel}
              onChange={(e) => setNotificationChannel(e.target.value)}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="both">Both (WhatsApp + SMS)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Used for all automated and bulk notifications
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Welcome Message</Label>
              <p className="text-xs text-muted-foreground">
                Send welcome notification when a new member is added
              </p>
            </div>
            <Switch checked={welcomeMessage} onCheckedChange={setWelcomeMessage} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Renewal Reminders</Label>
              <p className="text-xs text-muted-foreground">
                Notify members before membership expires
              </p>
            </div>
            <Switch checked={renewalReminder} onCheckedChange={setRenewalReminder} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Birthday Wishes</Label>
              <p className="text-xs text-muted-foreground">
                Send birthday greetings to members
              </p>
            </div>
            <Switch checked={birthdayWish} onCheckedChange={setBirthdayWish} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Announcement Notifications</Label>
              <p className="text-xs text-muted-foreground">
                Notify members about new announcements
              </p>
            </div>
            <Switch checked={announcementNotify} onCheckedChange={setAnnouncementNotify} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Offer / Promo Notifications</Label>
              <p className="text-xs text-muted-foreground">
                Notify members about promotions and offers
              </p>
            </div>
            <Switch checked={promoNotify} onCheckedChange={setPromoNotify} />
          </div>
        </CardContent>
      </Card>

      {/* Card 6: Automation / Cron Jobs */}
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>Automation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-xs text-muted-foreground">
            These jobs run automatically when triggered by an external scheduler (e.g., Vercel Cron).
            Toggle them on or off, or trigger manually.
          </p>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Renewal Reminders Cron</Label>
              <p className="text-xs text-muted-foreground">
                Send renewal + birthday notifications daily
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={triggeringCron !== null}
                onClick={async () => {
                  setTriggeringCron("renewal");
                  setCronResult(null);
                  try {
                    const res = await fetch("/api/cron/renewal-reminders");
                    const data = await res.json();
                    setCronResult(`Renewal: sent=${data.sent ?? 0}, skipped=${data.skipped ?? 0}, birthday=${data.birthdaySent ?? 0}`);
                  } catch {
                    setCronResult("Failed to trigger");
                  }
                  setTriggeringCron(null);
                }}
              >
                {triggeringCron === "renewal" ? "Running..." : "Run Now"}
              </Button>
              <Switch checked={cronRenewalReminders} onCheckedChange={setCronRenewalReminders} />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto-Checkout Cron</Label>
              <p className="text-xs text-muted-foreground">
                Check out members at location closing time
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={triggeringCron !== null}
                onClick={async () => {
                  setTriggeringCron("checkout");
                  setCronResult(null);
                  try {
                    const res = await fetch("/api/cron/auto-checkout");
                    const data = await res.json();
                    setCronResult(`Auto-checkout: closed=${data.closed ?? 0}`);
                  } catch {
                    setCronResult("Failed to trigger");
                  }
                  setTriggeringCron(null);
                }}
              >
                {triggeringCron === "checkout" ? "Running..." : "Run Now"}
              </Button>
              <Switch checked={cronAutoCheckout} onCheckedChange={setCronAutoCheckout} />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Re-engagement Cron</Label>
              <p className="text-xs text-muted-foreground">
                Reach out to expired members at 7, 14, 30 days
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={triggeringCron !== null}
                onClick={async () => {
                  setTriggeringCron("reengagement");
                  setCronResult(null);
                  try {
                    const res = await fetch("/api/cron/re-engagement");
                    const data = await res.json();
                    setCronResult(`Re-engagement: sent=${data.sent ?? 0}, skipped=${data.skipped ?? 0}`);
                  } catch {
                    setCronResult("Failed to trigger");
                  }
                  setTriggeringCron(null);
                }}
              >
                {triggeringCron === "reengagement" ? "Running..." : "Run Now"}
              </Button>
              <Switch checked={cronReEngagement} onCheckedChange={setCronReEngagement} />
            </div>
          </div>

          {cronResult && (
            <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">{cronResult}</p>
          )}
        </CardContent>
      </Card>

      {/* Card 7: Integrations */}
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* WhatsApp (MSG91) */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">WhatsApp (MSG91)</h3>
            <div className="space-y-2">
              <Label htmlFor="msg91-auth-key">Auth Key</Label>
              <Input
                id="msg91-auth-key"
                type="password"
                value={msg91AuthKey}
                onChange={(e) => setMsg91AuthKey(e.target.value)}
                placeholder="MSG91 auth key"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="msg91-wa-number">Integrated Number</Label>
              <Input
                id="msg91-wa-number"
                value={msg91WhatsappNumber}
                onChange={(e) => setMsg91WhatsappNumber(e.target.value)}
                placeholder="919876543210"
              />
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label htmlFor="test-wa-recipient">Test Recipient</Label>
                <Input
                  id="test-wa-recipient"
                  value={testRecipient}
                  onChange={(e) => setTestRecipient(e.target.value)}
                  placeholder="919876543210"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={testingChannel !== null || !testRecipient}
                onClick={async () => {
                  setTestingChannel("whatsapp");
                  setChannelTestResult(null);
                  try {
                    const res = await fetch("/api/admin/test-channel", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ channel: "whatsapp", recipient: testRecipient }),
                    });
                    const data = await res.json();
                    setChannelTestResult(data.success ? "WhatsApp test sent" : `Failed: ${data.error}`);
                  } catch {
                    setChannelTestResult("Failed to send test");
                  }
                  setTestingChannel(null);
                }}
              >
                {testingChannel === "whatsapp" ? "Sending..." : "Send Test"}
              </Button>
            </div>
          </div>

          <hr className="border-border" />

          {/* SMS (MSG91) */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">SMS (MSG91)</h3>
            <p className="text-xs text-muted-foreground">Uses the same Auth Key as WhatsApp above</p>
            <div className="space-y-2">
              <Label htmlFor="msg91-sms-flow">SMS Flow ID</Label>
              <Input
                id="msg91-sms-flow"
                value={msg91SmsFlowId}
                onChange={(e) => setMsg91SmsFlowId(e.target.value)}
                placeholder="Flow ID from MSG91"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="msg91-sms-sender">Sender ID</Label>
              <Input
                id="msg91-sms-sender"
                value={msg91SmsSenderId}
                onChange={(e) => setMsg91SmsSenderId(e.target.value)}
                placeholder="GYMFIT"
                maxLength={6}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={testingChannel !== null || !testRecipient}
              onClick={async () => {
                setTestingChannel("sms");
                setChannelTestResult(null);
                try {
                  const res = await fetch("/api/admin/test-channel", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ channel: "sms", recipient: testRecipient }),
                  });
                  const data = await res.json();
                  setChannelTestResult(data.success ? "SMS test sent" : `Failed: ${data.error}`);
                } catch {
                  setChannelTestResult("Failed to send test");
                }
                setTestingChannel(null);
              }}
            >
              {testingChannel === "sms" ? "Sending..." : "Send SMS Test"}
            </Button>
          </div>

          <hr className="border-border" />

          {/* Email (SMTP) */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Email (SMTP)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="smtp-host">SMTP Host</Label>
                <Input
                  id="smtp-host"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.gmail.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-port">Port</Label>
                <Input
                  id="smtp-port"
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  placeholder="587"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-user">Username</Label>
              <Input
                id="smtp-user"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="user@gmail.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-pass">Password</Label>
              <Input
                id="smtp-pass"
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder="App password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-from">From Address</Label>
              <Input
                id="smtp-from"
                value={smtpFrom}
                onChange={(e) => setSmtpFrom(e.target.value)}
                placeholder="noreply@gym.com"
              />
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label htmlFor="test-email-recipient">Test Recipient Email</Label>
                <Input
                  id="test-email-recipient"
                  type="email"
                  value={testRecipient}
                  onChange={(e) => setTestRecipient(e.target.value)}
                  placeholder="test@example.com"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={testingChannel !== null || !testRecipient}
                onClick={async () => {
                  setTestingChannel("email");
                  setChannelTestResult(null);
                  try {
                    const res = await fetch("/api/admin/test-channel", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ channel: "email", recipient: testRecipient }),
                    });
                    const data = await res.json();
                    setChannelTestResult(data.success ? `Email test sent (${data.mode})` : `Failed: ${data.error}`);
                  } catch {
                    setChannelTestResult("Failed to send test");
                  }
                  setTestingChannel(null);
                }}
              >
                {testingChannel === "email" ? "Sending..." : "Send Email Test"}
              </Button>
            </div>
          </div>

          <hr className="border-border" />

          {/* Biometric SDK */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Biometric SDK (BioMax)</h3>
            <div className="space-y-2">
              <Label htmlFor="biomax-url">SDK Base URL</Label>
              <Input
                id="biomax-url"
                value={biomaxBaseUrl}
                onChange={(e) => setBiomaxBaseUrl(e.target.value)}
                placeholder="http://192.168.1.100:8090"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="biomax-key">API Key</Label>
              <Input
                id="biomax-key"
                type="password"
                value={biomaxApiKey}
                onChange={(e) => setBiomaxApiKey(e.target.value)}
                placeholder="Device API key (if required)"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={testingBiomax}
              onClick={async () => {
                setTestingBiomax(true);
                setBiomaxTestResult(null);
                try {
                  const res = await fetch("/api/biometric/test-connection", { method: "POST" });
                  const data = await res.json();
                  setBiomaxTestResult(data.connected ? "Connected" : `Not connected: ${data.error}`);
                } catch {
                  setBiomaxTestResult("Connection test failed");
                }
                setTestingBiomax(false);
              }}
            >
              {testingBiomax ? "Testing..." : "Test Connection"}
            </Button>
            {biomaxTestResult && (
              <p className={`text-sm ${biomaxTestResult === "Connected" ? "text-status-active" : "text-destructive"}`}>
                {biomaxTestResult}
              </p>
            )}
          </div>

          {channelTestResult && (
            <p className="text-sm border rounded-md px-3 py-2 text-muted-foreground">{channelTestResult}</p>
          )}

          <p className="text-xs text-muted-foreground">
            Save settings first, then test. Credentials stored in DB override .env values.
          </p>
        </CardContent>
      </Card>

      {/* Card: Data Lifecycle */}
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>Data Lifecycle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Auto-archive stale followups</Label>
              <p className="text-xs text-muted-foreground">
                Followups older than threshold are auto-set to &quot;written off&quot;
              </p>
            </div>
            <Switch checked={dataCleanupEnabled} onCheckedChange={setDataCleanupEnabled} />
          </div>
          <div className="space-y-2">
            <Label>Followup archive threshold (days)</Label>
            <Input
              type="number"
              value={followupArchiveDays}
              onChange={(e) => setFollowupArchiveDays(e.target.value)}
              min={30}
              max={365}
            />
          </div>
          <div className="space-y-2">
            <Label>Enquiry auto-close threshold (days)</Label>
            <Input
              type="number"
              value={enquiryCloseDays}
              onChange={(e) => setEnquiryCloseDays(e.target.value)}
              min={30}
              max={365}
            />
            <p className="text-xs text-muted-foreground">
              Enquiries with no activity are auto-set to &quot;lost&quot;
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={runningCleanup}
              onClick={async () => {
                setRunningCleanup(true);
                setCleanupResult(null);
                try {
                  const { runDataCleanupAction } = await import("@/lib/actions/data-cleanup");
                  const result = await runDataCleanupAction();
                  if (result.success && "followupsArchived" in result) {
                    setCleanupResult(
                      `Done: ${result.followupsArchived} followups archived, ${result.enquiriesClosed} enquiries closed`
                    );
                  } else {
                    setCleanupResult(result.error || "Failed");
                  }
                } catch {
                  setCleanupResult("Failed to run cleanup");
                } finally {
                  setRunningCleanup(false);
                }
              }}
            >
              {runningCleanup ? "Running..." : "Run cleanup now"}
            </Button>
            {cleanupResult && (
              <p className="text-sm text-muted-foreground">{cleanupResult}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Card: Tax & Accounting (Tally + GSTR-1) */}
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>Tax &amp; Accounting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-xs text-muted-foreground">
            Used by the Tally Prime XML export and the quarterly GSTR-1 CSV.
            Gym GSTIN and state are configured under Gym Identity above.
          </p>
          <div className="space-y-2">
            <Label htmlFor="gym-service-hsn">HSN/SAC Code</Label>
            <Input
              id="gym-service-hsn"
              value={gymServiceHsn}
              onChange={(e) => setGymServiceHsn(e.target.value)}
              placeholder="999723"
            />
            <p className="text-xs text-muted-foreground">
              Default for Indian gym/fitness services is 999723.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gym-gst-rate">GST Rate (%)</Label>
            <Input
              id="gym-gst-rate"
              type="number"
              min="0"
              max="28"
              value={gymGstRate}
              onChange={(e) => setGymGstRate(e.target.value)}
              className="max-w-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              Used to back-calculate taxable value from GST-inclusive invoice
              totals in the Tally and GSTR-1 exports.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gym-gst-scheme">GST Scheme</Label>
            <select
              id="gym-gst-scheme"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={gymGstScheme}
              onChange={(e) => setGymGstScheme(e.target.value)}
            >
              <option value="regular">Regular</option>
              <option value="composition">Composition</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Composition scheme files CMP-08 instead of GSTR-1 — the GSTR-1
              report will be disabled if this is selected.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tally-sales-ledger">Tally Sales Ledger</Label>
            <Input
              id="tally-sales-ledger"
              value={tallySalesLedger}
              onChange={(e) => setTallySalesLedger(e.target.value)}
              placeholder="Sales"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tally-cgst-ledger">Tally CGST Ledger</Label>
            <Input
              id="tally-cgst-ledger"
              value={tallyCgstLedger}
              onChange={(e) => setTallyCgstLedger(e.target.value)}
              placeholder="CGST Output"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tally-sgst-ledger">Tally SGST Ledger</Label>
            <Input
              id="tally-sgst-ledger"
              value={tallySgstLedger}
              onChange={(e) => setTallySgstLedger(e.target.value)}
              placeholder="SGST Output"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tally-igst-ledger">Tally IGST Ledger</Label>
            <Input
              id="tally-igst-ledger"
              value={tallyIgstLedger}
              onChange={(e) => setTallyIgstLedger(e.target.value)}
              placeholder="IGST Output"
            />
          </div>
        </CardContent>
      </Card>

      {/* Card: Manager Briefing (PR 8) */}
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>Manager Briefing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-xs text-muted-foreground">
            Email the gym owner a daily morning briefing of top insights with
            one-click action links. Schedule is configured in <code>vercel.json</code>.
          </p>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Manager Briefing</Label>
              <p className="text-xs text-muted-foreground">
                Send a daily summary email to the gym owner
              </p>
            </div>
            <Switch
              checked={managerBriefingEnabled}
              onCheckedChange={setManagerBriefingEnabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gym-owner-name">Owner Name</Label>
            <Input
              id="gym-owner-name"
              value={gymOwnerName}
              onChange={(e) => setGymOwnerName(e.target.value)}
              placeholder="Owner"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gym-owner-email">Owner Email</Label>
            <Input
              id="gym-owner-email"
              type="email"
              value={gymOwnerEmail}
              onChange={(e) => setGymOwnerEmail(e.target.value)}
              placeholder="owner@gym.com"
            />
            <p className="text-xs text-muted-foreground">
              Briefings will be sent here. Requires SMTP configured above.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gym-owner-lang">Language</Label>
            <select
              id="gym-owner-lang"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={gymOwnerLang}
              onChange={(e) => setGymOwnerLang(e.target.value)}
            >
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="hinglish">Hinglish</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manager-min-severity">Minimum Severity</Label>
            <select
              id="manager-min-severity"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={managerMinSeverity}
              onChange={(e) => setManagerMinSeverity(e.target.value)}
            >
              <option value="critical">Critical only</option>
              <option value="high">High and above</option>
              <option value="medium">Medium and above</option>
              <option value="low">All severities</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Only insights at or above this severity are included
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manager-top-n">Top N Insights</Label>
            <Input
              id="manager-top-n"
              type="number"
              min="1"
              max="20"
              value={managerBriefingTopN}
              onChange={(e) => setManagerBriefingTopN(e.target.value)}
              className="max-w-[100px]"
            />
            <p className="text-xs text-muted-foreground">
              Maximum number of insights per briefing email
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manager-time">Briefing Time</Label>
            <Input
              id="manager-time"
              value={managerBriefingTime}
              onChange={(e) => setManagerBriefingTime(e.target.value)}
              placeholder="07:00"
              className="max-w-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              Display only — actual schedule is configured in <code>vercel.json</code> (default 07:00 IST)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={sendingTestBriefing}
              onClick={async () => {
                setSendingTestBriefing(true);
                setBriefingResult(null);
                try {
                  const { sendTestBriefingAction } = await import(
                    "@/lib/actions/manager"
                  );
                  const result = await sendTestBriefingAction();
                  if (result.success) {
                    if (result.skipped) {
                      setBriefingResult(`Skipped: ${result.reason ?? "see settings"}`);
                    } else {
                      setBriefingResult(
                        `Sent ${result.sent} email${result.sent === 1 ? "" : "s"} (${result.insightCount} insight${result.insightCount === 1 ? "" : "s"}${result.mode ? `, ${result.mode}` : ""})`
                      );
                    }
                  } else {
                    setBriefingResult(`Failed: ${result.error}`);
                  }
                } catch (err) {
                  setBriefingResult(
                    `Failed: ${err instanceof Error ? err.message : "unknown"}`
                  );
                } finally {
                  setSendingTestBriefing(false);
                }
              }}
            >
              {sendingTestBriefing ? "Sending..." : "Send test briefing now"}
            </Button>
            {briefingResult && (
              <p className="text-sm text-muted-foreground">{briefingResult}</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Save settings first, then test. Test respects all settings
            (including the enable flag).
          </p>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3 max-w-lg w-full">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving..." : "Save Settings"}
        </Button>
        {saved && (
          <span className="text-sm text-status-active">Settings saved</span>
        )}
        {error && (
          <span className="text-sm text-destructive">{error}</span>
        )}
      </div>
    </div>
  );
}
