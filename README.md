# TraqGym

All-in-one gym management software for fitness businesses in India. Members, billing, attendance, notifications — deployed as separate instances per gym.

## Features

- Member management (profiles, plans, renewals, freeze/unfreeze, cancellation)
- Billing & invoices (UPI QR, cash, GST-compliant PDF invoices)
- Attendance (kiosk check-in, biometric device sync, CSV import)
- WhatsApp/SMS notifications (renewal reminders, payment receipts, bulk notify)
- Multi-location support (per-location staff, devices, attendance)
- Reports & analytics (revenue, attendance, expiring memberships)
- Equipment tracking (inventory, maintenance, condition)
- Staff & leave management (roles, quotas, attendance)
- Member portal (dashboard, stats, invoices, classes)

## Tech Stack

- Next.js 16 (App Router) + TypeScript
- PostgreSQL 16 via Prisma 6
- NextAuth.js v4 (credentials)
- shadcn/ui + Tailwind CSS v4
- Recharts

## Quick Start (Local Dev)

```bash
# Clone and install
git clone <repo-url>
cd freeformfitnessOS
npm install

# Configure
cp .env.example .env
# Edit .env with your values

# Start database
docker compose up -d postgres

# Setup schema and seed data
npm run db:push
npm run db:seed

# Run dev server
npm run dev
```

Open http://localhost:3000. Login with `admin@gym.com` / `password123`.

## Production Deployment

### Prerequisites
- Docker and Docker Compose
- Domain with DNS (e.g., `traqgym.com` + `*.traqgym.com`)

### Deploy

```bash
# Build and start all services
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

### Onboard a New Gym

```bash
./scripts/onboard-gym.sh "EGym Andheri" egymandheri admin@egymandheri.com
```

This creates the env file, Docker services, Caddy routing, runs migrations, and seeds the admin account.

### Backups

```bash
./scripts/backup.sh
```

Daily cron recommended: `0 2 * * * /path/to/scripts/backup.sh`

## Project Structure

```
app/                    # Next.js routes
  admin/                # Worker dashboard (admin/staff)
  member/               # Member portal
  api/                  # API routes
  kiosk/                # Biometric check-in kiosk
lib/
  services/             # Business logic
  actions/              # Server actions (CRUD)
  auth.ts               # NextAuth config
prisma/
  schema.prisma         # Database schema
  migrations/           # Prisma migrations
  seed.ts               # Demo data
landing/                # Marketing site (separate Next.js app)
envs/                   # Per-gym environment configs
scripts/                # Deployment scripts
```

## Environment Variables

See [.env.example](.env.example) for the full list.
