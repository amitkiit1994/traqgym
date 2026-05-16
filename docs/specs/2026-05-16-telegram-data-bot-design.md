# Telegram "Talk-to-Data" Bot for FreeForm Fitness — Design

Date: 2026-05-16
Status: Approved, ready for implementation plan
Branch: `worktree-feat+telegram-bot`
Code location: `freeformfitnessOS/telegram-bot/`

## 1. Goal

A Telegram bot that lets the gym owner (Robin) and Amit ask natural-language questions about the FreeForm Fitness gym data (collections, members, balances, PT sessions, etc.) and get accurate, traceable answers grounded in the latest FitnessBoard (v3.fitnessboard.in) export.

Today this need is served by Amit running ad-hoc CSV queries and forwarding answers on WhatsApp. Goal: cut Amit out of the loop for routine number questions and reduce the chance of mistakes (e.g., the duplicate-flag mistake on 2026-05-16).

## 2. Non-Goals (out of scope for v1)

- Write operations (no creating payments, members, etc. from the bot)
- Multi-tenant support (only Free Form Fitness; EGYM Lokhandwala data is separate and not exposed)
- Public access — strictly allowlisted to 2 chat IDs
- Sub-daily data freshness — daily snapshot only in v1
- Cross-CSV joins in a single tool call (the LLM chains 2 calls instead)
- Markdown/HTML rich formatting — plain text replies in v1

## 3. Decisions Locked During Brainstorm

| Decision | Choice |
|---|---|
| Audience | Amit + Robin (2 Telegram chat IDs in an allowlist) |
| Data freshness | Daily snapshot, cron at 06:00 IST |
| Hosting | Vercel serverless (Next.js API route or standalone Vercel project) |
| LLM | Google Gemini 2.5 Flash |
| Data scope | All 8 CSVs available; LLM picks which to query per question |
| Tool design | Schema + bounded filter DSL (no code execution) |
| Cron host | GitHub Actions, daily + manual `workflow_dispatch` |
| CSV storage | Vercel Blob (date-partitioned + `latest.json` pointer) |
| Audit log | Vercel logs (`console.log`) only in v1 |
| Code location | New subdir `freeformfitnessOS/telegram-bot/` |
| Language/stack | TypeScript + Vercel Functions (fits existing Vercel/Next.js infra) |

## 4. Architecture

```
┌─────────────┐         ┌────────────────────┐
│  Telegram   │ webhook │  Vercel Function   │
│ (Robin/Amit)│────────▶│  /api/webhook      │
└─────────────┘         └─────────┬──────────┘
                                  │
                  ┌───────────────┼───────────────┐
                  ▼               ▼               ▼
          ┌──────────────┐  ┌──────────┐  ┌──────────────┐
          │ Allowlist    │  │  Gemini  │  │ Vercel Blob  │
          │ + secret-tok │  │ 4o-mini  │  │  CSV store   │
          │ + rate limit │  │ +tools   │  │              │
          └──────────────┘  └────┬─────┘  └──────┬───────┘
                                 │               │
                          tool calls─────────────┘
                          list_csvs / query_csv

┌───────────────────────────────────────────────────────┐
│  Daily 06:00 IST (00:30 UTC)                          │
│  GitHub Action → fetch_complete.py → Vercel Blob PUT  │
└───────────────────────────────────────────────────────┘
```

### Request flow (Telegram → answer)

1. Telegram POSTs update to `/api/webhook`.
2. Webhook verifies `X-Telegram-Bot-Api-Secret-Token` header against `WEBHOOK_SECRET` env (anti-spoof).
3. Parses `message.chat.id`; if not in `TELEGRAM_ALLOWED_CHAT_IDS` → reply "Not authorized" and return 200.
4. Slash-commands (`/start`, `/help`, `/snapshot`, `/refresh`, `/ping`) handled directly without LLM call.
5. Otherwise: per-chat rate limit check (max 20 msgs/min). If over, reply "Slow down a sec".
6. Load `csv/latest.json` from Blob (cached in module scope for 60s).
7. Build Gemini chat request: system prompt + `list_csvs` + `query_csv` tools + user message.
8. Run tool-calling loop (max 5 iterations to bound runaway calls). Each `query_csv` call streams the named CSV from Blob (also cached in module scope) and applies the bounded DSL.
9. Final assistant message → strip Markdown, format numbers Indian-style, append `📅 data as of <snapshot_date>`, split if >3500 chars.
10. POST reply via `sendMessage` API.

Target round-trip: <5s for typical questions, <10s worst-case with 3 tool calls.

### Cron flow

1. GitHub Action `refresh-export.yml` triggers at 00:30 UTC daily or via `workflow_dispatch`.
2. Action checks out `freeformfitness-data-export-fresh/fetch_complete.py` (already exists in repo).
3. Runs the scraper against v3.fitnessboard.in with FB credentials from GH secrets.
4. Uploads each CSV to Vercel Blob under `csv/YYYY-MM-DD/<filename>`.
5. Last step: writes `csv/latest.json` pointer atomically (this is the swap).
6. Deletes snapshots older than 30 days.

## 5. Tool Surface (Bounded DSL)

### `list_csvs() → object`

Returns metadata so the model knows what's available. Called once per session (or cached in the system prompt at build time and refreshed when `latest.json` changes).

```json
{
  "snapshot_date": "2026-05-16",
  "snapshot_ist": "2026-05-16T06:02:11+05:30",
  "csvs": [
    {
      "name": "payments",
      "rows": 669,
      "columns": ["Payment Date","Billing Name","Package Name","Payment Mode",
                  "Paid Amount","Net Amount","Bill No","Member Id","Start Date","End Date"],
      "date_columns": ["Payment Date","Start Date","End Date"],
      "sample_rows": [ /* 2 representative rows */ ]
    },
    { "name": "members", ... },
    { "name": "balance", ... },
    { "name": "memberenrollment", ... },
    { "name": "activeinactive", ... },
    { "name": "database", ... },
    { "name": "member_details", ... },
    { "name": "sessionreport", ... }
  ]
}
```

### `query_csv(args) → object`

JSON-schema-validated args. No code execution.

```ts
{
  csv: "payments",                            // required, must be in list_csvs
  filters?: [                                 // AND-joined
    { col: "Payment Date", op: "between", val: ["2026-04-01","2026-04-07"] },
    { col: "Payment Mode", op: "eq", val: "Cash" },
    { col: "Billing Name", op: "icontains", val: "viral" }
  ],
  group_by?: ["Payment Mode"],
  agg?: { col: "Paid Amount", fn: "sum" },   // sum|count|avg|min|max
  select?: ["Billing Name","Paid Amount"],
  order_by?: { col: "Payment Date", dir: "asc" },
  limit?: 50                                 // default 50, max 200
}
```

**Ops allowed:** `eq, neq, gt, gte, lt, lte, between, in, icontains, isblank, notblank`

**Date handling:** values that look like ISO dates (`YYYY-MM-DD`) are parsed; CSV dates in `DD-MM-YYYY` are normalized to ISO on read; comparison is date-aware.

**Number handling:** money columns are coerced to numbers (strip commas, `null` → 0 for aggregation).

**Returns:**
```json
{
  "rows": [/* up to limit rows after filters */],
  "row_count": 29,
  "truncated": false,
  "agg_result": { "Cash": 279700, "Gpay": 26000 }
}
```

**Errors:** invalid `csv` / `col` / `op` / `fn` → `{ "error": "...", "hint": "..." }` so the model can self-correct on the next turn.

### System prompt (sketch)

```
You are a data analyst for Free Form Fitness gym. Answer the user's question using ONLY the
data returned by the tools. Never make up numbers.

Two tools available:
- list_csvs: see what data exists
- query_csv: query a CSV with filters / group_by / agg

Rules:
- ALL money in Indian rupees, formatted with Indian commas (₹3,05,700).
- Today's date is <inject>. Snapshot date is <inject from latest.json>.
- If the answer needs data not in the CSVs, say so plainly.
- Keep replies short. End with: "📅 data as of <snapshot_date>".
- If question is ambiguous (e.g. "this week" without specifying), pick the most likely
  interpretation and state it ("Interpreting 'this week' as Mon-Sun of current week").
```

## 6. Auth, Commands, Rate Limit

### Setup (one-time)
1. Create bot via @BotFather → `TELEGRAM_BOT_TOKEN`.
2. Each user `/start`s the bot → bot logs `chat.id` → copy both into `TELEGRAM_ALLOWED_CHAT_IDS=12345,67890`.
3. Register webhook: `POST /setWebhook?url=...&secret_token=...`.

### Per-request auth
1. `X-Telegram-Bot-Api-Secret-Token` header === `WEBHOOK_SECRET` → else 401.
2. `chat.id` ∈ allowlist → else friendly "Not authorized" + 200.

### Slash commands (no LLM)
- `/start` — welcome + auth confirmation + their chat ID (helps onboarding).
- `/help` — example questions list.
- `/snapshot` — last refresh time + row counts.
- `/refresh` — triggers GH Action `workflow_dispatch` for ad-hoc refresh.
- `/ping` — `pong`.

### Reply formatting
- Plain text (no Markdown).
- Indian comma grouping for money.
- Footer: `📅 data as of <snapshot_date>`.
- If reply > 3500 chars, split.

### Rate limit
In-memory `Map<chatId, [timestamps]>` — last 60s, max 20 messages. Resets on cold start (good enough for a 2-user bot).

## 7. Cron & Data Pipeline

### GitHub Action `.github/workflows/refresh-export.yml`

```yaml
name: refresh-fitnessboard-export
on:
  schedule:
    - cron: "30 0 * * *"     # 00:30 UTC = 06:00 IST
  workflow_dispatch:
jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install -r telegram-bot/scripts/requirements-cron.txt
      - name: Fetch fresh CSVs
        env:
          FB_MOBILE:   ${{ secrets.FB_MOBILE }}
          FB_PASSWORD: ${{ secrets.FB_PASSWORD_FFF }}
        run: python freeformfitness-data-export-fresh/fetch_complete.py --out /tmp/csvs
      - name: Upload to Vercel Blob
        env:
          BLOB_READ_WRITE_TOKEN: ${{ secrets.VERCEL_BLOB_RW_TOKEN }}
        run: node telegram-bot/scripts/upload-blob.mjs /tmp/csvs
```

### Blob layout
```
csv/2026-05-16/export_payment_all.csv
csv/2026-05-16/export_balance_all.csv
csv/2026-05-16/...           (8 files per snapshot)
csv/latest.json              ← pointer, written last (atomic swap)
```

`latest.json`:
```json
{
  "snapshot_date": "2026-05-16",
  "snapshot_ist": "2026-05-16T06:02:11+05:30",
  "row_counts": { "payments": 670, "members": 412, "balance": 87, ... },
  "blob_urls": {
    "payments": "https://blob.vercel-storage.com/csv/2026-05-16/export_payment_all-<hash>.csv",
    ...
  }
}
```

### On-demand refresh
`/refresh` Telegram command → bot calls `POST /repos/<owner>/<repo>/actions/workflows/refresh-export.yml/dispatches` with a `GITHUB_PAT` → replies "Refresh started, takes ~5 min". (Optional v2: poll run status.)

### Failure handling
- GH Action fails → last good `latest.json` in Blob is untouched → bot keeps answering with previous snapshot.
- Bot computes `Date.now() - snapshot_ist`; if > 36h, prepends `⚠️ Data is <N> days old` to every answer.
- Refresh workflow is red on GH → Amit gets the normal GH email notification.

### Retention
Action's last step deletes snapshots in Blob older than 30 days (keeps last good rollbacks available).

## 8. Project Structure

```
freeformfitnessOS/telegram-bot/
├── api/
│   └── webhook.ts                # POST /api/webhook entrypoint (Vercel function)
├── src/
│   ├── auth.ts                   # allowlist + secret-token check
│   ├── commands.ts               # /start, /help, /snapshot, /refresh, /ping
│   ├── llm.ts                    # Gemini tool-calling loop
│   ├── tools/
│   │   ├── list-csvs.ts          # list_csvs implementation
│   │   ├── query-csv.ts          # query_csv DSL executor
│   │   └── schema.ts             # JSON schemas for both tools
│   ├── data/
│   │   ├── blob-store.ts         # fetch CSV + latest.json from Vercel Blob
│   │   └── csv-parse.ts          # streaming CSV → typed rows with date/number coercion
│   ├── telegram/
│   │   ├── send-message.ts       # sendMessage API wrapper + chunking
│   │   └── format.ts             # Indian rupee formatter
│   ├── rate-limit.ts             # in-memory per-chat limiter
│   └── config.ts                 # env var loader + validation
├── scripts/
│   ├── upload-blob.mjs           # CLI used by GH Action
│   ├── requirements-cron.txt     # python deps for fetch_complete.py on GH
│   └── register-webhook.mjs      # one-time webhook registration helper
├── tests/
│   ├── query-csv.test.ts         # DSL filter / agg / group_by unit tests
│   ├── csv-parse.test.ts         # date + number coercion tests
│   ├── auth.test.ts              # allowlist + rate-limit tests
│   └── fixtures/                 # tiny sample CSVs
├── .env.example
├── vercel.json
├── package.json
├── tsconfig.json
└── README.md
```

Workflow file lives at repo root (NOT inside `telegram-bot/`) because GitHub only reads workflows from `<repo-root>/.github/workflows/`:

```
freeformfitnessOS/.github/workflows/refresh-export.yml   # new file
```

## 9. Environment Variables

```
# .env.example
TELEGRAM_BOT_TOKEN=                # from BotFather
TELEGRAM_ALLOWED_CHAT_IDS=         # comma-separated, e.g. 12345,67890
WEBHOOK_SECRET=                    # any long random string
GOOGLE_API_KEY=                    # user-provided (aistudio.google.com/apikey)
GEMINI_MODEL=gemini-2.5-flash      # default; overridable
BLOB_LATEST_URL=                   # URL of csv/latest.json in Vercel Blob (set after first upload)
BLOB_READ_WRITE_TOKEN=             # Vercel Blob token (function reads only)
GITHUB_PAT=                        # optional; only needed for /refresh command
GITHUB_REPO=amitkumardas/freeformfitnessOS  # for workflow_dispatch
LOG_LEVEL=info
```

## 10. Error Handling

| Failure | Behavior |
|---|---|
| Telegram secret token mismatch | 401, log warn |
| chat_id not in allowlist | Reply "Not authorized", 200 |
| Rate limit exceeded | Reply "Slow down, try in a moment", 200 |
| `latest.json` missing in Blob | Reply "No data yet — Amit needs to run first export". Log error. |
| `latest.json` stale > 36h | Prepend warning to answer; still answer |
| Gemini API error (5xx/timeout) | Retry once after 1s; if still fails, reply "AI is having a bad day, try again in a minute" |
| Gemini returns no tool call after 5 iterations | Reply "I couldn't figure out how to answer that — try rephrasing" |
| `query_csv` invalid args | Return structured error to model; model self-corrects on next turn |
| CSV column referenced doesn't exist | Same as above |
| GH Action `workflow_dispatch` fails on `/refresh` | Reply "Couldn't trigger refresh — check GH" |

## 11. Observability

- All requests/responses log to `console.log` → visible in Vercel function logs.
- Log shape (JSON, one line per request): `{ ts, chat_id, q, n_tool_calls, model, latency_ms, snapshot_date, answer_preview }`.
- Errors log with `console.error` + stack.
- Vercel free-tier logs retain ~24h — acceptable for v1. If Robin disputes an answer later, Amit reproduces with same CSV snapshot (kept 30 days in Blob).

## 12. Testing Strategy

- **Unit tests (vitest):**
  - `query-csv.test.ts` — every op (eq/neq/gt/lt/between/in/icontains/isblank), agg fns, group_by, error cases. Fixtures = small handcrafted CSVs.
  - `csv-parse.test.ts` — DD-MM-YYYY → ISO, comma-thousands money parsing, blank fields.
  - `auth.test.ts` — allowlist match/miss, secret token mismatch, rate-limit overflow.
  - `format.test.ts` — Indian comma (3,05,700 not 305,700).
- **Integration tests:** mock Gemini, mock Blob → run webhook end-to-end with fixture CSVs. Verify a known question produces a known tool call and a known final answer.
- **Manual smoke test (post-deploy):** ask 5 reference questions from real April data, compare against known answers (e.g., "how much collected 1-7 April" → must say 305700).
- **No Telegram-side e2e tests in v1.**

## 13. Security

- Telegram webhook signature via `WEBHOOK_SECRET` header (Telegram's built-in mechanism).
- Allowlist on `chat.id` (NOT username — usernames are mutable).
- No code execution from LLM output — query_csv is a typed JSON DSL parsed/validated server-side.
- Secrets (`OPENAI_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `TELEGRAM_BOT_TOKEN`, `GITHUB_PAT`, `FB_PASSWORD_FFF`) live in Vercel env vars + GH Actions secrets. Never logged.
- Rate limit prevents runaway Gemini bills if either chat ID is compromised.
- Function does NOT have Blob write token (read-only), so a compromised function can't corrupt snapshots.
- GH Actions has Blob write token but not read-public.

## 14. Cost Model (rough)

- Gemini Gemini 2.5 Flash ≈ $0.0001 per question (system prompt + 1-2 tool calls + answer).
- 50 questions/day × 30 days = ~$0.15/mo Gemini.
- Vercel Hobby tier: $0 (well within limits).
- Vercel Blob free tier: 1GB storage / 1GB bandwidth — easily covers 30 daily snapshots of ~500KB each.
- GitHub Actions: free for public repos / 2000 min/mo on private — using ~5 min/day = ~150 min/mo.
- **Total: <$1/mo** assuming reasonable usage.

## 15. Open Questions / Deferred

- Multi-CSV joins (e.g., "active members with outstanding balance") — model chains 2 calls today; v2 might add a `join_csvs` tool if patterns emerge.
- Chart/screenshot replies — out of scope v1; would need matplotlib + image upload.
- WhatsApp parity — out of scope; Telegram first because of existing plugin awareness + cleaner bot API.
- EGYM Lokhandwala data — separate gym, separate FB account, deliberately not in v1.
- Persistent audit log (Google Sheet) — explicitly deferred to v2.
