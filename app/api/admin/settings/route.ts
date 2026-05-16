import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/services/settings";
import { checkOrigin } from "@/lib/services/csrf";

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
  // Tax & Accounting (Tally + GSTR-1)
  "gym_service_hsn",
  "gym_gst_rate",
  "gym_gst_scheme",
  "tally_sales_ledger",
  "tally_cgst_ledger",
  "tally_sgst_ledger",
  "tally_igst_ledger",
  // QR self-check-in
  "qr_checkin_enabled",
  "qr_checkin_rate_limit_hours",
  "qr_token_max_age_days",
  "qr_checkin_allow_phone_only",
  // PR 8: Manager Briefing
  "gym_owner_name",
  "gym_owner_email",
  "gym_owner_lang",
  "manager_briefing_enabled",
  "manager_min_severity",
  "manager_briefing_top_n",
  "manager_briefing_time",
  // PR 9: Telegram
  "telegram_enabled",
  "telegram_webhook_secret",
  "gym_owner_telegram_chat_id",
  "gym_owner_telegram_user_id",
  "telegram_bot_username",
  // PR 16: Manager hardening (K.1, K.3, K.5)
  "gym_owner_emails",                  // K.5 — co-owner emails (CSV)
  "gym_owner_telegram_chat_ids",       // K.5 — co-owner chat ids (CSV)
  "gym_closed_days",                   // K.1 — CSV weekday names (e.g. "sunday")
  "manager_min_repeat_hours",          // K.1 — fatigue dedup window
  "manager_link_ttl_default_hours",    // K.3 — default TTL for non-destructive
  "manager_link_ttl_revoke_hours",     // K.3 — short TTL for revoke/destructive
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
  // PR 8: Manager Briefing
  gym_owner_name: "Owner",
  gym_owner_email: "",
  gym_owner_lang: "en",
  manager_briefing_enabled: "false",
  manager_min_severity: "high",
  manager_briefing_top_n: "5",
  manager_briefing_time: "07:00",
  // PR 9: Telegram
  telegram_enabled: "false",
  telegram_webhook_secret: "",
  gym_owner_telegram_chat_id: "",
  gym_owner_telegram_user_id: "",
  telegram_bot_username: "",
  // PR 16: Manager hardening
  gym_owner_emails: "",                // K.5 — additional CSV recipients
  gym_owner_telegram_chat_ids: "",     // K.5 — additional CSV chat ids
  gym_closed_days: "",                 // K.1 — empty = always open
  manager_min_repeat_hours: "48",      // K.1 — default fatigue window
  manager_link_ttl_default_hours: "24", // K.3 — non-destructive default TTL
  manager_link_ttl_revoke_hours: "4",   // K.3 — destructive action TTL
};

// S02: Keys that contain credentials/secrets/PII. Non-admin workers (e.g. staff,
// front-desk) must NOT see the values for these keys — they are blanked out
// before responding. Admins still receive the real values.
//
// Selection rule: any key matching /(secret|token|key|pass|auth|chat_id|webhook|api)/i
// is treated as a secret, EXCEPT keys starting with "feature_" or equal to
// "gym_owner_lang" or pure display keys.
const SECRET_KEY_PATTERN = /(secret|token|key|pass|auth|chat_id|webhook|api)/i;
const SECRET_KEY_EXCEPTIONS = new Set<string>([
  "gym_owner_lang",
]);
const SECRET_KEYS: string[] = SETTINGS_KEYS.filter((key) => {
  if (key.startsWith("feature_")) return false;
  if (SECRET_KEY_EXCEPTIONS.has(key)) return false;
  return SECRET_KEY_PATTERN.test(key);
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).actorType !== "worker") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result: Record<string, string> = {};
  for (const key of SETTINGS_KEYS) {
    result[key] = await getSetting(key, DEFAULTS[key] ?? "");
  }

  // S02: Mask secret values for non-admin workers. Keep keys present so the
  // client UI shape stays stable (existing readers use `data.x ?? ""`).
  if ((session.user as any).role !== "admin") {
    for (const key of SECRET_KEYS) {
      result[key] = "";
    }
  }

  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const csrf = checkOrigin(req);
  if (!csrf.ok) return Response.json({ error: csrf.error }, { status: 403 });

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
