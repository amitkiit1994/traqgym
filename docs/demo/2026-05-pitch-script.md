# TraqGym Pitch Demo Script

**Audience:** Gym owners in India who run on FitnessBoard v3 or similar legacy software.
**Length target:** 5-7 minutes
**Setup:** Open in Chrome, one window with `https://freeformfitness.traqgym.com` already logged in as admin, one phone with the Telegram bot configured (if available).

---

## The story arc

1. **Pain:** Running a gym on v3 fitnessboard means everything is manual — exports, follow-ups, decisions
2. **Solution:** TraqGym = one platform, AI does the boring work, you focus on members
3. **Proof:** Robin's gym (Free Form Fitness) running live on TraqGym for the last month with full v3 data
4. **Onboarding:** "Give us your v3 credentials, see your data in TraqGym tomorrow morning"

---

## Demo flow (with timings)

### 0:00 — Open Dashboard
URL: `/admin/dashboard`

**Say:** "This is Robin's gym. 367 members, 668 payments, ₹17 lakh in expired memberships. All of this came from his v3 fitnessboard account — synced nightly so it's always current."

Point at: total members tile, recent activity feed, expiring-soon counter.

### 1:00 — Members list with empty state demo
URL: `/admin/members`

**Say:** "Members are searchable, filterable. When a new gym signs up with no data yet, we show this:" — quickly switch to a search that returns zero (e.g., "zzz") to show the contextual empty state.

### 1:30 — Plans + Renewals
URL: `/admin/renewals`

**Say:** "Today's expirations. Auto-list of who needs renewal call. Sorted by value — top 5 = 70% of recoverable revenue."

(If renewal queue is empty: switch to `/admin/balance-due` to show the pending balance list.)

### 2:30 — Reports → real numbers
URL: `/admin/reports/membership-matrix` (or similar — pick the prettiest one)

**Say:** "PT vs Gym, mode of payment, sales rep performance, churn signals. This used to be three spreadsheets and a calculator. Now it's a click."

### 3:30 — The AI assistant
Open Telegram on phone (or `/admin/ai-assistant` if Telegram not configured).

**Say:** "And the magic — Robin can just ask in Telegram."

Type: `How much PT money did we collect last week?`

The AI returns the actual computed number. (We computed this manually in this session: ₹58,500 for May 1-7.)

Type: `Who needs to renew this week?`

The AI returns the renewal list (~24 names sorted by value).

**Say:** "Voice notes work too — Robin can ask while driving."

### 5:00 — Onboarding pitch
URL: `/admin/settings/integrations/fitnessboard`

**Say:** "When you sign up, you'll see this. Paste your v3 fitnessboard username and password. Tonight at 2:30 AM IST, our pipeline pulls all your members, payments, memberships — everything. Tomorrow morning, you log in to TraqGym and see your full gym ready to go."

### 5:30 — Pricing + close

**Pricing:** [insert your actual pricing]
**Onboarding:** "Two-minute setup. Done."
**Free trial:** "First 30 days free — we sync your data, you compare for yourself."

---

## Pre-demo checklist (do day-of)

- [ ] `freeformfitness.traqgym.com` loads cleanly
- [ ] Logged in as `carruthersrobin3@gmail.com / Robin@FFF2026`
- [ ] Dashboard tiles populated (sync ran successfully last night)
- [ ] Telegram bot responding (if configured) — send `/start` to verify
- [ ] Phone Bluetooth ready if doing voice demo
- [ ] Backup screenshots in `docs/demo/screenshots/` in case live demo fails
- [ ] WiFi solid

---

## Common prospect questions + answers

**"How do we trust the data?"**
We don't replace v3 yet. We sync nightly. You keep using v3, see the same data in TraqGym, and switch when you're comfortable.

**"What if v3 goes down or we don't pay them?"**
Then you cut over. All your data is already in TraqGym. Stop paying v3, use TraqGym standalone.

**"Online payments?"**
Cash + UPI work today. Razorpay is optional — we enable it per-gym when you ask. Not table stakes for most Indian gyms yet.

**"How much?"**
₹[X]/month per location. Free 30-day trial. No setup fees. No long contract.

**"Can my staff use it?"**
Yes — separate Worker accounts with admin vs staff roles. Staff can do day-to-day; only admins see financial reports.

**"What about WhatsApp?"**
SMS works today via MSG91. WhatsApp Business templates are on the roadmap.

---

## Failure-mode contingencies

- **Internet drops:** open the screenshots dir, walk through statically. The story arc still works.
- **AI bot doesn't respond:** open `/admin/ai-assistant` in browser instead. Same demo.
- **A page errors:** skip it, go to the next. Don't dwell on bugs.
- **Prospect asks about a feature we don't have:** "Not yet — what's the use case? We're adding features based on customer asks."

---

## Post-demo follow-up

Within 2 hours of the demo:
- Send the prospect a recap email (or WhatsApp) with their gym name plugged in
- Include the pricing one-pager
- Offer to schedule a follow-up to do the v3 sync setup live with them

If they're ready to onboard:
1. They give you their v3 credentials in person/WhatsApp
2. You run `./scripts/onboard-gym.sh "Their Gym Name" subdomain admin@theiremail.com --phone ... etc.`
3. They configure the v3 sync at `/admin/settings/integrations/fitnessboard`
4. Tomorrow morning their data is in TraqGym

---

## What's NOT in the demo (yet)

These exist in code but skip the demo until they're polished:

- Decimal financial migration (planned, not yet shipped — see `docs/plans/2026-05-16-phase3a-decimal.md`)
- Self-serve signup at `/signup` (deferred — manual onboarding for first 10 gyms)
- Sentry observability (deferred to follow-up)
- Telegram pair code rate limiting (deferred — current 8-char hex is OK at low scale)
- Restore script `scripts/restore.sh` (deferred)
