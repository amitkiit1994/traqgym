# TraqGym

Gym management SaaS — separate instance per gym, deployed via Docker. Built for fitness businesses in India. White-label: each gym sees its own branding, "Powered by TraqGym" at bottom.

## Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** PostgreSQL 16 via Prisma 6
- **Auth:** NextAuth.js v4 (credentials provider)
- **UI:** shadcn/ui (Base UI primitives, not Radix) + Tailwind CSS v4
- **Charts:** Recharts
- **Language:** TypeScript
- **Theme:** Dark mode default. Light mode uses glassmorphism (backdrop-blur, OKLch alpha transparency).

## Commands

```bash
# Development
npm run dev                # App on :3000
cd landing && npm run dev  # Landing site on :3010

# Build
npm run build

# Database (local dev)
npm run db:push        # Push schema to DB
npm run db:seed        # Seed demo data
npm run db:reset       # Reset + reseed

# Database (production)
npm run db:migrate     # Run Prisma migrations

# Docker (local dev — Colima runtime on macOS)
colima start
docker compose up -d postgres

# Production
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# Local multi-instance test
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml up

# Onboard new gym (3 required + 22 optional flags)
./scripts/onboard-gym.sh "Gym Name" subdomain admin@email.com \
  --phone "..." --email "..." --address "..." --city "..." --gstin "..." --upi "..."

# Backup
./scripts/backup.sh

# Data migration (FitnessBoard → TraqGym)
npx tsx scripts/migrate-fitnessboard.ts  # Idempotent, safe to re-run
```

## Architecture

- **Service layer:** All business logic in `lib/services/`. UI calls services, never raw Prisma.
- **Server actions:** CRUD operations in `lib/actions/` for admin pages, `member-*.ts` for member pages.
- **Auth:** Worker table checked first (admin/staff), then User table (member). Session includes `actorType`, `role`, `locationId`.
- **Auth guard:** `lib/auth-guard.ts` — `requireWorker(["admin"])` for admin-only actions, `requireWorker()` for any worker.
- **Routes:** `/admin/*` for workers, `/member/*` for members, `/login` for auth.
- **Middleware:** Protects `/admin/*` (workers only) and `/member/*` (members only). Staff restricted from `/admin/workers`, `/admin/reports`, location create/edit.
- **Deployment:** One Next.js instance + one PostgreSQL database per gym. Production runs on Vercel (one project per gym, e.g. `traqgym-app` for Free Form Fitness on `main`, `traqgym-egym` for E-GYM Lokhandwala on `egymlokhandwala` branch). Vercel project `rootDirectory` must be set to `freeformfitnessOS`. External managed PostgreSQL per instance (e.g., Railway). Older docker-compose + Caddy setup remains for self-hosted scenarios.
- **Landing site:** Separate Next.js static app at `landing/` served at `traqgym.com`.
- **Onboarding:** `scripts/onboard-gym.sh` provisions new gym instances with full identity (phone, address, GSTIN, UPI, logo, integrations).
- **Gym identity:** Stored in `GymSettings` key-value table (gym_name, gym_phone, gym_address, gym_gstin, gym_logo, etc.).

## Admin Pages (37 sections)

Dashboard, Members, Renewals, Plans, Enquiries, Followups, Balance Due, Attendance, Classes, Facility Bookings, Equipment, Leaves, Workers, Staff Performance, Payroll, Expenses, Reports (P&L, Membership Matrix, Source Analysis, Login History), Bulk Notify, Announcements, Notifications, In-App Notifications, POS, Promos, Gift Cards, Family Groups, Waivers, Workout Plans, Diet Plans, Biometric, AI Activity, AI Assistant, Audit Log, Settings, Activity, Locations.

## Member Pages (16 sections)

Dashboard (Home), Stats, Profile, Invoices, Measurements, Classes, Announcements, Referrals, Waivers, Workout Plans, Diet Plans, Bookings, Notifications, In-App Notifications.

## Staff vs Admin Roles

Staff can do day-to-day operations: member check-in, renewals, payments, enquiry followups, attendance, classes, bulk notify, balance tracking. Admin-only: workers CRUD, reports, expenses, payroll, settings, audit, staff performance, AI settings, leave approval, member transfer, password reset, enquiry assignment, gym targets, biometric management.

## Key Files

- `Dockerfile` — multi-stage app build
- `docker-compose.prod.yml` — production services (apps, DBs, Caddy)
- `docker-compose.local.yml` — local dev override (exposed ports, no Caddy)
- `Caddyfile` — subdomain routing + auto-SSL
- `envs/` — per-gym environment configs
- `scripts/onboard-gym.sh` — gym provisioning (3 required + 22 optional args)
- `scripts/backup.sh` — daily DB backups
- `scripts/migrate-fitnessboard.ts` — imports FitnessBoard CSV data (users, plans, tickets, payments, enquiries, followups)
- `scripts/reset-fitnessboard.ts` — reset migration data
- `competitor-data-export/` — source CSV files from FitnessBoard v3
- `landing/` — marketing site (port 3010)
- `components/ui/dialog.tsx` — Base UI Dialog (not Radix). Popup centered via wrapper div, not CSS transform.
- `lib/auth-guard.ts` — role-based access control for server actions
- `middleware.ts` — route protection + staff restrictions

## Key Invariants

- `AttendanceLog`: Exactly one of `userId` or `workerId` must be non-null.
- `DeviceUserMapping`: Exactly one of `userId` or `workerId` must be non-null.
- Renewal flow is atomic: MemberTicket + Payment + Invoice + AuditLog in one transaction.
- 60-second idempotency window on renewals.
- Dialog/modal centering: Use `fixed inset-0 flex items-center justify-center` wrapper div with `pointer-events-none`, Popup gets `pointer-events-auto`. Do NOT use `top-1/2 -translate-y-1/2` (breaks with tall content).
- Invoice/PDF links must use `target="_blank" rel="noopener noreferrer"` to open in new tab.

## UI Conventions

- shadcn/ui components use **Base UI** primitives (not Radix). Import from `@base-ui/react/*`.
- Glass effect: `bg-popover/85 backdrop-blur-xl backdrop-saturate-[1.3]` for light, `bg-popover/95` for dark.
- Card shadows: purple-tinted `shadow-[0_8px_40px_oklch(0.565_0.20_275_/_8%)]` in light mode.
- CSS variables use OKLch color space with alpha for transparency.
- Dark mode is default (`class="dark"` on html). Theme toggle available in sidebar/nav.
- Admin layout: vertical collapsible sidebar (56px–224px) with grouped nav + badge counts.
- Member layout: horizontal sticky top bar with pill-shaped nav items.

## Production Data

**Free Form Fitness** (`main` branch, Vercel project `traqgym-app`)
- Admin: admin@freeformfitness.com / password123
- Staff: e.g. pooja.singh@staff.freeform.local / password123
- Members: imported from FitnessBoard — email is `{phone}@imported.local`, password is their phone number
- ~303 users, ~16 plans, ~570 tickets, ~566 payments, 5 enquiries

**E-GYM Lokhandwala** (`egymlokhandwala` branch, Vercel project `traqgym-egym`, Railway PostgreSQL)
- Theme: red/black (OKLCh hue 25), logo `/egym-logo.png`
- Admin: carruthersrobin3@gmail.com / Robin@FFF2026
- Members: imported from E-Gym CSV exports
- 10,275 users, 102 plans, 9,803 tickets, 14,771 payments, 3,779 enquiries, 7,701 followups
- Domain target: `egymlokhandwala.traqgym.com`
- Bulk data load uses `pg_dump --inserts` + `psql -f` (Prisma migration script drops connections on Railway after ~30 min)

## Build Configuration

- `package.json` build script: `prisma generate && next build`
- `package.json` postinstall: `prisma generate`
- Without these, Vercel builds fail with `Property 'X' does not exist on type 'PrismaClient'` after schema changes.

@AGENTS.md
