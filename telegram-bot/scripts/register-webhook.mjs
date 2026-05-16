#!/usr/bin/env node
// Usage:
//   TELEGRAM_BOT_TOKEN=... WEBHOOK_SECRET=... WEBHOOK_URL=https://.../api/webhook \
//     node scripts/register-webhook.mjs
//
// Re-run any time you change the URL or secret.

const token  = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.WEBHOOK_SECRET;
const url    = process.env.WEBHOOK_URL;

for (const [k, v] of Object.entries({
  TELEGRAM_BOT_TOKEN: token,
  WEBHOOK_SECRET: secret,
  WEBHOOK_URL: url,
})) {
  if (!v) { console.error(`Missing ${k}`); process.exit(1); }
}

const endpoint = `https://api.telegram.org/bot${token}/setWebhook`;
const body = { url, secret_token: secret, allowed_updates: ["message"] };

const res = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const out = await res.json();
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exit(1);
