// MSG91 SMS API
// Reads credentials from DB settings first, falls back to env vars.
// Falls back to console.log if credentials not set.

import { getSetting } from "@/lib/services/settings";

export async function send(params: {
  recipient: string;
  templateName: string;
  variables?: Record<string, string>;
}) {
  const authKey = (await getSetting("msg91_auth_key", "")) || process.env.MSG91_AUTH_KEY;
  const flowId = (await getSetting("msg91_sms_flow_id", "")) || process.env.MSG91_SMS_FLOW_ID;
  const senderId = (await getSetting("msg91_sms_sender_id", "")) || process.env.MSG91_SMS_SENDER_ID;

  if (!authKey || !flowId) {
    console.log(
      `[SMS DEV] "${params.templateName}" to ${params.recipient}`,
      params.variables
    );
    return { success: true, channel: "sms", mode: "dev" };
  }

  try {
    const response = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: authKey,
      },
      body: JSON.stringify({
        flow_id: flowId,
        sender: senderId,
        mobiles: formatIndianPhone(params.recipient),
        ...(params.variables ?? {}),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[SMS] Failed: ${err}`);
      return { success: false, channel: "sms", error: err };
    }

    return { success: true, channel: "sms", mode: "live" };
  } catch (err) {
    console.error("[SMS] Error:", err);
    return { success: false, channel: "sms", error: String(err) };
  }
}

function formatIndianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("91") ? digits : `91${digits}`;
}
