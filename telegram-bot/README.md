# FreeForm Telegram Bot

Talk-to-data Telegram bot for FreeForm Fitness gym. Allowlisted (Amit + Robin).
Answers natural-language questions about collections, members, balances, etc.
grounded in daily FitnessBoard CSV exports.

See `docs/specs/2026-05-16-telegram-data-bot-design.md` for design and
`docs/plans/2026-05-16-telegram-data-bot.md` for the implementation plan.

## Local development

    npm install
    npm test
    npm run typecheck

## One-time setup

1. **Create the bot:** Telegram → @BotFather → `/newbot` → copy `TELEGRAM_BOT_TOKEN`.
2. **Each user `/start`s the bot once.** Capture their `chat.id` from Vercel logs (or use the `getUpdates` API). Set `TELEGRAM_ALLOWED_CHAT_IDS=<amit_id>,<robin_id>`.
3. **Google AI (Gemini) key:** create at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free tier covers our load. Copy to `GOOGLE_API_KEY`. (Optional: set a daily quota cap in Cloud Console as a safety net.)
4. **Vercel project:** `vercel link` from `telegram-bot/`, set Root Directory to `telegram-bot/` in Vercel dashboard. Set all envs from `.env.example` in Vercel project settings.
5. **Vercel Blob:** create a Blob store in Vercel dashboard → Storage. Copy the `BLOB_READ_WRITE_TOKEN` into Vercel envs AND into GitHub secrets as `VERCEL_BLOB_RW_TOKEN`.
6. **Seed the first snapshot manually** (so step 8 has data to read):
   - From your laptop, generate a fresh FB cookie (log into v3.fitnessboard.in in browser, copy cookie string), save to `/tmp/fb_cookie_string.txt`
   - Run `python freeformfitness-data-export-fresh/fetch_complete.py` to fetch CSVs into `freeformfitness-data-export-fresh/`
   - Run `BLOB_READ_WRITE_TOKEN=... node telegram-bot/scripts/upload-blob.mjs freeformfitness-data-export-fresh`
   - Copy the printed `csv/latest.json` URL — you'll need it as `BLOB_LATEST_URL`
7. **GitHub secrets** (repo settings → secrets and variables → actions):
   - `FB_COOKIE` = full cookie string from your browser session (refresh when it expires, typically every few weeks)
   - `VERCEL_BLOB_RW_TOKEN` = same as Vercel
8. **Set `BLOB_LATEST_URL`** in Vercel envs to the URL from step 6 (looks like `https://<store-id>.public.blob.vercel-storage.com/csv/latest.json`).
9. **Deploy:** `vercel deploy --prod` from `telegram-bot/`.
10. **Register webhook:**

        TELEGRAM_BOT_TOKEN=... \
        WEBHOOK_SECRET=... \
        WEBHOOK_URL=https://<your-vercel-domain>/api/webhook \
        node scripts/register-webhook.mjs

11. **Verify GH Action cron** is green: GitHub → Actions → "refresh-fitnessboard-export" → "Run workflow" to trigger manually first time.

## Smoke test (after deploy)

In Telegram, with the authorized account, send each:

| Message | Expected |
|---|---|
| `/ping` | `pong` |
| `/snapshot` | snapshot date + row counts |
| `/help` | example questions list |
| `how much collected 1 to 7 april?` | should report ₹3,05,700 |
| `cash vs gpay 1-7 april` | ₹2,79,700 cash + ₹26,000 gpay |
| `pt revenue 1-7 april` | ₹1,70,500 |

If any number is wrong, check function logs (`vercel logs`) for the tool call args + result.

## Operational notes

- Refresh runs daily at 06:00 IST. Use `/refresh` to trigger ad-hoc (needs `GITHUB_PAT` env var).
- 30 days of snapshots retained in Vercel Blob; older auto-deleted by the cron.
- Logs are in Vercel function logs (retained ~24h on free tier).
- Rate limit: 20 messages / minute / user (in-memory, resets on cold start).
- When the FB cookie expires (you'll see GH Action failures), grab a fresh one from browser DevTools → Application → Cookies on v3.fitnessboard.in, update the `FB_COOKIE` GH secret.
