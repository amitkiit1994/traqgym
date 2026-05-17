# TraqGym Telegram Bot

AI gym-data analyst on Telegram. Allowlisted users (owner + approved staff)
ask plain-English questions about collections, members, balances, PT,
sessions, attendance — and get answers grounded in the day's snapshot of
the gym's business data. Automatically flags data-quality issues
(backlog entries, gaps, possible duplicates).

See `docs/specs/2026-05-16-telegram-data-bot-design.md` for design and
`docs/plans/2026-05-16-telegram-data-bot.md` for the implementation plan.

## Stack

- Vercel Functions (TypeScript, Node 20)
- OpenAI Agents SDK + gpt-5
- Vercel Blob (daily CSV snapshot + dynamic allowlist)
- GitHub Actions cron (daily auto-login + scrape)

## Local development

    npm install
    npm test
    npm run typecheck

## One-time setup

1. **Create the bot:** Telegram → @BotFather → `/newbot` → copy `TELEGRAM_BOT_TOKEN`.
2. **Each user `/start`s the bot once.** Capture their `chat.id` from Vercel logs
   (or use the `getUpdates` API). Set `TELEGRAM_ALLOWED_CHAT_IDS=<owner_id>`
   (additional users are added later via `/approve` — no redeploy needed).
3. **OpenAI key:** create at platform.openai.com, add credit, copy to `OPENAI_API_KEY`.
4. **Vercel project:** `vercel link` from `telegram-bot/`, set Root Directory
   to `telegram-bot/` in Vercel dashboard. Set all envs from `.env.example`
   in Vercel project settings.
5. **Vercel Blob:** create a Blob store in Vercel dashboard → Storage. Copy
   the `BLOB_READ_WRITE_TOKEN` into Vercel envs AND into GitHub secrets as
   `VERCEL_BLOB_RW_TOKEN`.
6. **Seed the first snapshot manually** (so step 8 has data to read):
   - Run `FB_MOBILE=... FB_PASSWORD=... FB_OUT_DIR=./out python freeformfitness-data-export-fresh/fetch_complete.py`
   - Run `BLOB_READ_WRITE_TOKEN=... node telegram-bot/scripts/upload-blob.mjs ./out`
   - Copy the printed `csv/latest.json` URL — you'll need it as `BLOB_LATEST_URL`
7. **GitHub secrets** (repo settings → secrets and variables → actions):
   - `FB_MOBILE` = source-system login mobile
   - `FB_PASSWORD` = source-system password
   - `VERCEL_BLOB_RW_TOKEN` = same as Vercel
8. **Set `BLOB_LATEST_URL`** in Vercel envs to the URL from step 6 (looks like
   `https://<store-id>.public.blob.vercel-storage.com/csv/latest.json`).
9. **Deploy:** `vercel deploy --prod` from `telegram-bot/`.
10. **Register webhook:**

        TELEGRAM_BOT_TOKEN=... \
        WEBHOOK_SECRET=... \
        WEBHOOK_URL=https://<your-vercel-domain>/api/webhook \
        node scripts/register-webhook.mjs

11. **Verify GH Action cron** is green: GitHub → Actions → "refresh-gym-data"
    → "Run workflow" to trigger manually first time.

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

## Owner commands (allowlist)

- `/allowlist` — list approved non-owner users
- `/approve <chat_id> [name]` — add a user
- `/revoke <chat_id>` — remove a user

When an unauthorized user `/start`s the bot, it replies with their chat ID so
they can forward it to the owner.

## Operational notes

- Refresh runs daily at 06:00 IST. Use `/refresh` to trigger ad-hoc (needs
  `GITHUB_PAT` env var).
- 30 days of snapshots retained in Vercel Blob; older auto-deleted by the cron.
- Logs are in Vercel function logs (retained ~24h on free tier).
- Rate limit: 20 messages / minute / user (in-memory, resets on cold start).
- Source-system credentials live in GitHub secrets only. The fetcher logs in
  fresh on every cron run — no cookie babysitting.
