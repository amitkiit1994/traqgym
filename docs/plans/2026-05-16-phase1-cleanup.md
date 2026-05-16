# Phase 1: Repo Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove ~125MB+ of stale artifacts from the repo, tighten `.gitignore` to prevent regression, verify everything still builds.

**Architecture:** Pure file deletions and `.gitignore` additions — no code changes. Verify build + tests still pass before committing each grouping.

**Tech Stack:** git, bash, npm

**Source spec:** `docs/specs/2026-05-16-path-to-prod-design.md` Phase 1.

**Out of scope for this plan:** Encryption infra (Phase 2.5), nightly pipeline (Phase 2), Decimal migration (Phase 3a).

---

## Pre-flight check

Run from `/Users/amitkumardas/freeformOS/freeformfitnessOS/` unless otherwise noted.

- [ ] **Step 0a: Confirm clean baseline**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
git status --short
```

Expected: only the path-to-prod spec/master/plan files appear as new or modified (from prior commits). Anything else that's modified/staged should be checked with the user before proceeding.

- [ ] **Step 0b: Confirm build works today (baseline)**

```bash
npm run build
```

Expected: passes. If it fails today, stop and fix or report — don't proceed with cleanup that would mask the failure.

---

### Task 1: Inventory parent-dir artifacts to delete

Parent directory `/Users/amitkumardas/freeformOS/` contains stray screenshots from prior debugging sessions and a comparison doc. The `worktrees/` dir is stale (124MB).

**Files (in `/Users/amitkumardas/freeformOS/`, NOT inside `freeformfitnessOS/`):**
- 27 stray PNG files (egym-*, trainer-*, pt-page.png, plans.png, etc.)
- `fb-vs-traqgym-comparison.md`
- `worktrees/` directory (124MB)
- `FreeFormOSMemory/` (contains only Obsidian default `Welcome.md` — was never used)

- [ ] **Step 1: List exactly what would be deleted in parent dir**

```bash
cd /Users/amitkumardas/freeformOS
ls -la *.png fb-vs-traqgym-comparison.md FreeFormOSMemory worktrees 2>&1
```

Expected: see the 27 PNGs, the .md file, FreeFormOSMemory/ dir, worktrees/ dir. Verify nothing unexpected.

- [ ] **Step 2: Delete the artifacts (parent dir)**

```bash
cd /Users/amitkumardas/freeformOS
rm -f cash-shifts.png egym-comps.png egym-dashboard-prod.png egym-dashboard-v2.png \
      egym-login-red.png egym-login-v2.png egym-members.png gstr1.png \
      member-home.png members-filtered.png mobile-pt-table-overflow.png \
      multi-location.png payment-schedules.png plans.png pt-page.png \
      refunds.png settings.png shifts.png tally-export.png tally.png \
      trainer-dash-1440.png trainer-dashboard.png trainer-detail.png \
      trainer-mobile.png trainer-payouts-mobile-nav-clipped.png \
      trainers-page.png fb-vs-traqgym-comparison.md
rm -rf FreeFormOSMemory worktrees
```

- [ ] **Step 3: Verify cleanup of parent dir**

```bash
cd /Users/amitkumardas/freeformOS
ls *.png fb-vs-traqgym-comparison.md FreeFormOSMemory worktrees 2>&1
```

Expected: all `ls` lookups should return "No such file or directory" — proves the deletes worked. The directory listing should now show only `freeformfitnessOS/`, `competitor-data-export` (symlink), `.DS_Store`, `.gitignore`, and the data export directories.

Note: parent dir is not a tracked git repo (or is a separate repo from `freeformfitnessOS`). No commit needed here. Cleanup is filesystem-only.

---

### Task 2: Clean inside `freeformfitnessOS/`

Inside the app repo, multiple artifacts have accumulated outside what `.gitignore` covers.

**Files to delete:**
- `_audit_EGYM_math_mismatch.csv` (root-level audit artifact)
- `_audit_EGYM_write_offs.csv` (root-level audit artifact)
- `out/` directory (Next.js export artifact, regenerated on build)
- `.playwright-mcp/` directory (Playwright session cache from old debugging sessions)
- `tsconfig.tsbuildinfo` (regenerated on build)

- [ ] **Step 1: Verify the targets exist and confirm not tracked**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
ls -la _audit_EGYM_math_mismatch.csv _audit_EGYM_write_offs.csv out tsconfig.tsbuildinfo .playwright-mcp 2>&1
git ls-files _audit_EGYM_math_mismatch.csv _audit_EGYM_write_offs.csv out tsconfig.tsbuildinfo .playwright-mcp 2>&1
```

Expected:
- First `ls` shows the files/dirs exist on disk
- `git ls-files` returns NOTHING (confirming none are tracked — we won't lose git history)

- [ ] **Step 2: Delete the artifacts**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
rm -f _audit_EGYM_math_mismatch.csv _audit_EGYM_write_offs.csv tsconfig.tsbuildinfo
rm -rf out .playwright-mcp
```

- [ ] **Step 3: Verify deletion**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
ls _audit_EGYM_math_mismatch.csv _audit_EGYM_write_offs.csv out tsconfig.tsbuildinfo .playwright-mcp 2>&1
```

Expected: all "No such file or directory".

- [ ] **Step 4: Verify build still passes (regenerates the build artifacts)**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
npm run build
```

Expected: passes. Build will regenerate `.next/`, `tsconfig.tsbuildinfo`. `out/` only regenerates if a static export is run — not needed.

---

### Task 3: Consolidate data export directories

Two directories with overlapping data:
- `freeformfitness-data-export/` — original April 11 export (9 CSVs)
- `freeformfitness-data-export-fresh/` — today's fresh export (~26 CSVs)

Strategy: keep the fresh one as canonical, archive the April one for traceability, update the `competitor-data-export` symlink (in parent dir) to point at the fresh dir.

- [ ] **Step 1: Check what the symlink currently points to**

```bash
ls -la /Users/amitkumardas/freeformOS/competitor-data-export
```

Expected output (will look something like):
```
competitor-data-export -> /Users/amitkumardas/freeformOS/freeformfitnessOS/freeformfitness-data-export
```

- [ ] **Step 2: Move the April baseline to an archive subdirectory**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
mkdir -p docs/archives
mv freeformfitness-data-export docs/archives/freeformfitness-data-export-2026-04-11
ls docs/archives/freeformfitness-data-export-2026-04-11/ | head -10
```

Expected: lists the original 9 CSVs (active_inactive, all_data_report, all_people, balance, calls, database_full, members, payments, prospects).

- [ ] **Step 3: Rename the fresh dir to be the canonical name**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
mv freeformfitness-data-export-fresh freeformfitness-data-export
ls freeformfitness-data-export/ | head -5
```

Expected: lists CSVs starting with `ajax_memberships_Data1.csv`, `export_database_all.csv`, etc.

- [ ] **Step 4: Recreate the parent-dir symlink to point at the canonical dir**

```bash
cd /Users/amitkumardas/freeformOS
rm -f competitor-data-export
ln -s /Users/amitkumardas/freeformOS/freeformfitnessOS/freeformfitness-data-export competitor-data-export
ls -la competitor-data-export
```

Expected: shows the symlink pointing to `.../freeformfitness-data-export`.

- [ ] **Step 5: Verify migration script still resolves correctly**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
grep -n "competitor-data-export\|freeformfitness-data-export" scripts/migrate-fitnessboard.ts scripts/backfill-zero-amount-payments-fff.ts scripts/backfill-user-createdat-fff.ts
```

Expected: prints lines confirming the script reads from `competitor-data-export/` (which is now the symlink → fresh dir).

---

### Task 4: Tighten `.gitignore`

Add patterns that should have been there originally. Prevent the artifacts we just deleted from coming back.

- [ ] **Step 1: Show current `.gitignore` to verify starting state**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
cat .gitignore | tail -15
```

Expected: ends with the existing `# Capacitor` block.

- [ ] **Step 2: Append the new patterns**

Use the Edit tool on `/Users/amitkumardas/freeformOS/freeformfitnessOS/.gitignore` with these exact strings:

`old_string`:
```
# Capacitor
android/app/build/
android/.gradle/
```

`new_string`:
```
# Capacitor
android/app/build/
android/.gradle/

# Local data exports + audits — never commit (contain member PII)
freeformfitness-data-export*/
egymlokhandwala-data-export/
_audit_*.csv

# Playwright cache (old debug sessions)
.playwright-mcp/

# Sprint/findings working notes
.sprint-findings/

# Per-gym env scratch files
.env.*.tmp
```

- [ ] **Step 3: Verify the additions**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
tail -20 .gitignore
```

Expected: shows the new block at the end.

- [ ] **Step 4: Verify nothing previously tracked is now ignored (would break diffs)**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
git ls-files | xargs -I {} git check-ignore -v {} 2>/dev/null | head -5
```

Expected: NO OUTPUT. If anything appears, that's a tracked file that the new `.gitignore` would now ignore — investigate before continuing.

- [ ] **Step 5: Verify currently-untracked artifacts are now ignored**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
git status --short | grep -E "freeformfitness-data-export|_audit_|\.playwright-mcp"
```

Expected: NO OUTPUT (the new patterns hide them from `git status`).

---

### Task 5: Commit cleanup

- [ ] **Step 1: Verify final repo state**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
git status --short
```

Expected: only `.gitignore` should appear as modified, plus the new `docs/archives/` directory and the master+phase1 plan files (if not already committed).

- [ ] **Step 2: Stage and commit**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
git add .gitignore docs/plans/2026-05-16-path-to-prod-master.md docs/plans/2026-05-16-phase1-cleanup.md
git commit -m "$(cat <<'EOF'
chore: phase 1 — repo cleanup

- Delete stray PNGs, audit CSVs, build artifacts, Playwright cache
- Consolidate freeformfitness-data-export-fresh -> canonical name;
  archive original April 11 baseline to docs/archives/
- Tighten .gitignore for data exports, audits, playwright cache,
  sprint findings, env scratch files
- Add path-to-prod master roadmap and Phase 1 detail plan

Reclaims ~125MB of disk and prevents regression. No app code touched.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Verify commit landed**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
git log --oneline -1
git show --stat HEAD
```

Expected: latest commit is the cleanup, shows 3 file changes (`.gitignore`, master plan, phase1 plan).

---

### Task 6: Verification — build + smoke test

- [ ] **Step 1: Build**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
npm run build
```

Expected: passes with no errors.

- [ ] **Step 2: Run vitest unit tests**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
npm test -- --run
```

Expected: all passing (or same set of skipped tests as baseline — no NEW failures introduced by cleanup).

- [ ] **Step 3: Verify migration script can still find its data**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
head -1 /Users/amitkumardas/freeformOS/competitor-data-export/payments.csv 2>&1
```

Expected: prints the CSV header (`Sr No.,Reg. Id,Branch Name,...`) — confirms the symlink + canonical dir rename worked.

---

## Done criteria

- [ ] All 6 tasks above checked off
- [ ] Parent dir no longer contains 27 PNGs or `worktrees/`
- [ ] `freeformfitnessOS/` no longer has `out/`, `.playwright-mcp/`, `_audit_*.csv`, `tsconfig.tsbuildinfo`
- [ ] `freeformfitness-data-export/` (no `-fresh` suffix) is the canonical data dir
- [ ] April baseline preserved at `docs/archives/freeformfitness-data-export-2026-04-11/`
- [ ] `.gitignore` updated with new patterns
- [ ] `npm run build` passes
- [ ] `npm test -- --run` passes
- [ ] Cleanup commit landed on `main`

## Next phase plan trigger

Once this phase commits, write `docs/plans/2026-05-XX-phase2.5-encryption.md` (where `XX` = the date you start Phase 2.5). Use the spec's Phase 2.5 section as the source.
