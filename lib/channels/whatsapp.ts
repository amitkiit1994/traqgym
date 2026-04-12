// MSG91 WhatsApp API
// Reads credentials from DB settings first, falls back to env vars.
// Falls back to console.log if credentials not set.

import { getSetting } from "@/lib/services/settings";

export async function send(params: {
  recipient: string;
  templateName: string;
  variables?: Record<string, string>;
}) {
  const authKey = (await getSetting("msg91_auth_key", "")) || process.env.MSG91_AUTH_KEY;
  const integratedNumber = (await getSetting("msg91_whatsapp_number", "")) || process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER;

  if (!authKey || !integratedNumber) {
    console.log(
      `[WhatsApp DEV] "${params.templateName}" to ${params.recipient}`,
      params.variables
    );
    return { success: true, channel: "whatsapp", mode: "dev" };
  }

  try {
    const response = await fetch(
      "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authkey: authKey,
        },
        body: JSON.stringify({
          integrated_number: integratedNumber,
          content_type: "template",
          payload: {
            messaging_product: "whatsapp",
            type: "template",
            template: {
              name: params.templateName,
              language: { code: "en" },
              components: params.variables
                ? [
                    {
                      type: "body",
                      parameters: Object.values(params.variables).map((v) => ({
                        type: "text",
                        text: v,
                      })),
                    },
                  ]
                : [],
            },
          },
          recipients: [{ mobiles: formatIndianPhone(params.recipient) }],
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error(`[WhatsApp] Failed: ${err}`);
      return { success: false, channel: "whatsapp", error: err };
    }

    return { success: true, channel: "whatsapp", mode: "live" };
  } catch (err) {
    console.error("[WhatsApp] Error:", err);
    return { success: false, channel: "whatsapp", error: String(err) };
  }
}

function formatIndianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("91") ? digits : `91${digits}`;
}
