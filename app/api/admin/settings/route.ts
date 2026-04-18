import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/services/settings";

const SETTINGS_KEYS = [
  // Branding
  "gym_name",
  "gym_logo",
  "gym_address",
  "gym_phone",
  "gym_email",
  "gym_gstin",
  "gym_state",
  "gym_upi_vpa",
  // Financial
  "gst_rate",
  "registration_fee",
  "payment_modes",
  // Membership policy
  "grace_period_days",
  "renewal_reminder_days",
  "max_freezes_per_membership",
  "max_freeze_days",
  // Kiosk
  "auto_checkout_enabled",
  "checkin_cooldown_seconds",
  // Communication
  "birthday_wish_enabled",
  "renewal_reminder_enabled",
  "announcement_notify_enabled",
  "promo_notify_enabled",
  "notification_channel",
  "welcome_message_enabled",
  // Automation / Cron
  "cron_renewal_reminders_enabled",
  "cron_auto_checkout_enabled",
  "cron_re_engagement_enabled",
  // Leave policy
  "leave_casual_quota",
  "leave_sick_quota",
  "leave_personal_quota",
  // Integrations — MSG91 (WhatsApp + SMS)
  "msg91_auth_key",
  "msg91_whatsapp_number",
  "msg91_sms_flow_id",
  "msg91_sms_sender_id",
  // Integrations — Email (SMTP)
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_pass",
  "smtp_from",
  // Integrations — Biometric SDK
  "biomax_sdk_base_url",
  "biomax_sdk_api_key",
  // QR self-check-in
  "qr_checkin_enabled",
  "qr_checkin_rate_limit_hours",
  "qr_token_max_age_days",
  "qr_checkin_allow_phone_only",
];

const DEFAULTS: Record<string, string> = {
  gym_name: "",
  gym_logo: "",
  gym_address: "",
  gym_phone: "",
  gym_email: "",
  gym_gstin: "",
  gym_state: "Maharashtra",
  gym_upi_vpa: "",
  gst_rate: "18",
  registration_fee: "0",
  payment_modes: "cash,upi",
  grace_period_days: "7",
  renewal_reminder_days: "7,3,1",
  max_freezes_per_membership: "2",
  max_freeze_days: "30",
  auto_checkout_enabled: "true",
  checkin_cooldown_seconds: "60",
  birthday_wish_enabled: "true",
  renewal_reminder_enabled: "true",
  announcement_notify_enabled: "true",
  promo_notify_enabled: "true",
  notification_channel: "whatsapp",
  welcome_message_enabled: "true",
  cron_renewal_reminders_enabled: "true",
  cron_auto_checkout_enabled: "true",
  cron_re_engagement_enabled: "true",
  leave_casual_quota: "12",
  leave_sick_quota: "6",
  leave_personal_quota: "3",
  msg91_auth_key: "",
  msg91_whatsapp_number: "",
  msg91_sms_flow_id: "",
  msg91_sms_sender_id: "",
  smtp_host: "",
  smtp_port: "587",
  smtp_user: "",
  smtp_pass: "",
  smtp_from: "",
  biomax_sdk_base_url: "",
  biomax_sdk_api_key: "",
  qr_checkin_enabled: "false",
  qr_checkin_rate_limit_hours: "4",
  qr_token_max_age_days: "365",
  qr_checkin_allow_phone_only: "false",
};

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).actorType !== "worker") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result: Record<string, string> = {};
  for (const key of SETTINGS_KEYS) {
    result[key] = await getSetting(key, DEFAULTS[key] ?? "");
  }

  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (
    !session ||
    (session.user as any).actorType !== "worker" ||
    (session.user as any).role !== "admin"
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  for (const key of SETTINGS_KEYS) {
    if (key in body) {
      await setSetting(key, String(body[key]));
    }
  }

  return NextResponse.json({ success: true });
}
