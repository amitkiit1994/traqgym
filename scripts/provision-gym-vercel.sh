#!/usr/bin/env bash
# Provision a new gym as a Vercel project — lead to live workspace in ~15 min.
#
# This is the Vercel-era sibling of scripts/onboard-gym.sh (docker-compose +
# Caddy, self-hosted). Same arguments and seed semantics, different substrate:
# one Vercel project per gym, all deploying the SAME GitHub branch (main),
# with per-gym identity/branding supplied entirely through env vars and the
# GymSettings table. Brand color comes from NEXT_PUBLIC_GYM_THEME_HUE
# (validated 0-360 in app/layout.tsx, default 275) — never from branch code.
#
# Usage:
#   ./scripts/provision-gym-vercel.sh "Gold Star Fitness" goldstar admin@goldstar.com \
#     --hue 145 \
#     --database-url "postgresql://user:pass@host/db?sslmode=require" \
#     --phone "+919876543210" --city "Mumbai" --gstin "27AAAAA0000A1Z5"
#
# Required positional args (identical to onboard-gym.sh):
#   $1  Gym name
#   $2  Subdomain (lowercase, [a-z0-9-], becomes <subdomain>.traqgym.com and
#       Vercel project traqgym-<subdomain>)
#   $3  Admin email
#
# Required environment:
#   VERCEL_TOKEN     Personal/CI token created in the Vercel team that owns
#                    traqgym.com and the existing traqgym-app / traqgym-egym
#                    projects (NOT your personal hobby account — the domain
#                    traqgym.com and the GitHub install for amitkiit1994/traqgym
#                    live in that team). Create at: Team Settings -> Tokens.
#   VERCEL_TEAM_ID   The same team's ID (team_...). Find it at:
#                    Team Settings -> General -> Team ID.
#
# Database (step a) — two supported paths, no vendor hard-dependency:
#   1. Bring your own (Railway, Neon, RDS, anything Postgres 16):
#        pass --database-url "postgresql://..."
#      Railway (what E-GYM Lokhandwala runs on): dashboard -> New Project ->
#      Deploy PostgreSQL -> Variables -> copy DATABASE_PUBLIC_URL.
#   2. Auto-create on Neon (needs `neonctl` installed + NEON_API_KEY env or
#      `neonctl auth` done): omit --database-url and the script creates a
#      Neon project named traqgym-<subdomain> in --neon-region (default
#      aws-ap-southeast-1, Singapore — closest Neon region to Vercel sin1,
#      which is where vercel.json pins the app).
#
# Options (gym identity — mirrors onboard-gym.sh):
#   --phone --email --address --city --state --pincode --gstin --upi
# Options (integrations — mirrors onboard-gym.sh; can also be set later in
# /admin/settings):
#   --msg91-key --msg91-whatsapp --msg91-sms-flow --msg91-sender
#   --smtp-host --smtp-port --smtp-user --smtp-pass --smtp-from
#   --biomax-url --biomax-key
# Options (new, Vercel-specific):
#   --hue <0-360>          NEXT_PUBLIC_GYM_THEME_HUE (default 275 / purple;
#                          E-GYM red is 25). Brand hue ONLY — semantic colors
#                          are hardcoded in globals.css and not affected.
#   --database-url <url>   Skip DB provisioning, use this Postgres URL.
#   --neon-region <id>     Neon region-id for auto-create (default
#                          aws-ap-southeast-1).
#   --root-directory <dir> Vercel project rootDirectory. Default: repo root
#                          (package.json lives at the root of
#                          amitkiit1994/traqgym on main). Only set this if
#                          the team's projects use a nested layout.
#
# NOT supported (vs onboard-gym.sh): --logo. Vercel's filesystem is read-only
# at runtime so there is no docker-cp equivalent; upload the logo at
# /admin/settings after first login (printed in the final checklist).
#
# Idempotency: this script provisions NEW gyms only. It fails fast — with an
# explanation and no partial cleanup — if the Vercel project, any env var, or
# the domain already exists. Re-running after a partial failure: delete the
# half-created project in the Vercel dashboard first (and the Neon project if
# one was created), then re-run.
#
# KNOWN LIMITATION — Vercel<->GitHub integration: the existing fleet deploys
# via .github/workflows/auto-deploy-vercel.yml (vercel pull/build/deploy
# --prebuilt) precisely because the team's Vercel->GitHub git integration has
# been broken/missing (see that workflow's header). Steps 3 and 6 here use the
# git-linked API path; if they fail with a repo-access error, the fallback is:
#   1. create the project WITHOUT gitRepository (remove it from the create
#      body, or create via dashboard), then
#   2. add the new project's id as a matrix entry in
#      .github/workflows/auto-deploy-vercel.yml (plus a VERCEL_<GYM>_PROJECT_ID
#      GitHub secret) and deploy via that workflow's workflow_dispatch.
# Either way, ongoing deploys for ALL gyms should ride pushes to main.

set -euo pipefail

# ─── Constants ───────────────────────────────────────────────────────────────
VERCEL_API="https://api.vercel.com"
GITHUB_REPO="amitkiit1994/traqgym"   # must be reachable by the team's GitHub install
GIT_BRANCH="main"                    # single production branch; branding is env-driven
BASE_DOMAIN="traqgym.com"

# ─── Logging helpers ─────────────────────────────────────────────────────────
log()  { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die()  { printf '[%s] ERROR: %s\n' "$(date '+%H:%M:%S')" "$*" >&2; exit 1; }

# ─── Usage ───────────────────────────────────────────────────────────────────
usage() {
  cat <<'EOF'
Usage: provision-gym-vercel.sh <gym-name> <subdomain> <admin-email> [options]

Required:
  $1  Gym name          (e.g., "Gold Star Fitness")
  $2  Subdomain         (e.g., goldstar -> goldstar.traqgym.com)
  $3  Admin email       (e.g., admin@goldstar.com)

Required env: VERCEL_TOKEN, VERCEL_TEAM_ID (from the Vercel team that owns
traqgym.com — see header comment).

Database:    --database-url <url>   (any managed Postgres: Railway, Neon, ...)
       or:   auto-create via neonctl (needs NEON_API_KEY or prior neonctl auth)

Identity:    --phone --email --address --city --state --pincode --gstin --upi
Integration: --msg91-key --msg91-whatsapp --msg91-sms-flow --msg91-sender
             --smtp-host --smtp-port --smtp-user --smtp-pass --smtp-from
             --biomax-url --biomax-key
Vercel:      --hue <0-360>  --neon-region <id>  --root-directory <dir>
EOF
  exit 1
}

[ $# -lt 3 ] && usage

GYM_NAME="$1"
SUBDOMAIN="$2"
ADMIN_EMAIL="$3"
shift 3

# ─── Defaults (identity/integration defaults mirror onboard-gym.sh) ─────────
GYM_PHONE=""
GYM_EMAIL=""
GYM_ADDRESS=""
GYM_CITY=""
GYM_STATE="Maharashtra"
GYM_PINCODE=""
GYM_GSTIN=""
GYM_UPI_VPA="${SUBDOMAIN}@upi"

MSG91_AUTH_KEY=""
MSG91_WHATSAPP_NUM=""
MSG91_SMS_FLOW_ID=""
MSG91_SMS_SENDER_ID=""
SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""
BIOMAX_URL=""
BIOMAX_KEY=""

THEME_HUE="275"
DATABASE_URL_ARG=""
NEON_REGION="aws-ap-southeast-1"
ROOT_DIRECTORY=""

# ─── Parse named options (same style as onboard-gym.sh) ──────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --phone)        GYM_PHONE="$2"; shift 2 ;;
    --email)        GYM_EMAIL="$2"; shift 2 ;;
    --address)      GYM_ADDRESS="$2"; shift 2 ;;
    --city)         GYM_CITY="$2"; shift 2 ;;
    --state)        GYM_STATE="$2"; shift 2 ;;
    --pincode)      GYM_PINCODE="$2"; shift 2 ;;
    --gstin)        GYM_GSTIN="$2"; shift 2 ;;
    --upi)          GYM_UPI_VPA="$2"; shift 2 ;;
    --msg91-key)       MSG91_AUTH_KEY="$2"; shift 2 ;;
    --msg91-whatsapp)  MSG91_WHATSAPP_NUM="$2"; shift 2 ;;
    --msg91-sms-flow)  MSG91_SMS_FLOW_ID="$2"; shift 2 ;;
    --msg91-sender)    MSG91_SMS_SENDER_ID="$2"; shift 2 ;;
    --smtp-host)    SMTP_HOST="$2"; shift 2 ;;
    --smtp-port)    SMTP_PORT="$2"; shift 2 ;;
    --smtp-user)    SMTP_USER="$2"; shift 2 ;;
    --smtp-pass)    SMTP_PASS="$2"; shift 2 ;;
    --smtp-from)    SMTP_FROM="$2"; shift 2 ;;
    --biomax-url)   BIOMAX_URL="$2"; shift 2 ;;
    --biomax-key)   BIOMAX_KEY="$2"; shift 2 ;;
    --hue)            THEME_HUE="$2"; shift 2 ;;
    --database-url)   DATABASE_URL_ARG="$2"; shift 2 ;;
    --neon-region)    NEON_REGION="$2"; shift 2 ;;
    --root-directory) ROOT_DIRECTORY="$2"; shift 2 ;;
    --logo)
      die "--logo is not supported on Vercel (read-only filesystem). Upload the logo at /admin/settings after first login."
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

# ─── Step 0/8: Preflight ─────────────────────────────────────────────────────
log "Step 0/8: Preflight checks..."

for cmd in curl jq openssl node npx; do
  command -v "$cmd" >/dev/null 2>&1 || die "Required command not found: $cmd"
done

[ -n "${VERCEL_TOKEN:-}" ]   || die "VERCEL_TOKEN is not set (create one in the Vercel team that owns ${BASE_DOMAIN})"
[ -n "${VERCEL_TEAM_ID:-}" ] || die "VERCEL_TEAM_ID is not set (Team Settings -> General -> Team ID)"

case "$SUBDOMAIN" in
  *[!a-z0-9-]*|-*|*-)
    die "Subdomain must be lowercase [a-z0-9-], not starting/ending with '-': got '$SUBDOMAIN'"
    ;;
esac

case "$THEME_HUE" in
  ''|*[!0-9]*) die "--hue must be an integer 0-360 (got '$THEME_HUE')" ;;
esac
[ "$THEME_HUE" -le 360 ] || die "--hue must be 0-360 (got $THEME_HUE)"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
[ -d "$PROJECT_DIR/node_modules/@prisma/client" ] || die "node_modules missing in $PROJECT_DIR — run 'npm install' first (needed for migrate + seed)"
[ -f "$PROJECT_DIR/prisma/schema.prisma" ]        || die "prisma/schema.prisma not found under $PROJECT_DIR"

PROJECT_NAME="traqgym-${SUBDOMAIN}"
GYM_DOMAIN="${SUBDOMAIN}.${BASE_DOMAIN}"
NEXTAUTH_URL="https://${GYM_DOMAIN}"
ADMIN_PASSWORD="$(openssl rand -base64 12)"
NEXTAUTH_SECRET="$(openssl rand -base64 32)"

# Build full address string from parts (same logic as onboard-gym.sh)
FULL_ADDRESS="$GYM_ADDRESS"
if [ -n "$GYM_CITY" ] && [ -n "$FULL_ADDRESS" ]; then
  FULL_ADDRESS="${FULL_ADDRESS}, ${GYM_CITY}"
elif [ -n "$GYM_CITY" ]; then
  FULL_ADDRESS="$GYM_CITY"
fi
if [ -n "$GYM_PINCODE" ] && [ -n "$FULL_ADDRESS" ]; then
  FULL_ADDRESS="${FULL_ADDRESS} - ${GYM_PINCODE}"
elif [ -n "$GYM_PINCODE" ]; then
  FULL_ADDRESS="$GYM_PINCODE"
fi

log "Provisioning: $GYM_NAME"
log "  Project:   $PROJECT_NAME (Vercel team $VERCEL_TEAM_ID)"
log "  Domain:    https://$GYM_DOMAIN"
log "  Repo:      $GITHUB_REPO @ $GIT_BRANCH"
log "  Admin:     $ADMIN_EMAIL"
log "  Theme hue: $THEME_HUE"

# ─── Vercel API helper ───────────────────────────────────────────────────────
# Sets VERCEL_HTTP_STATUS and VERCEL_HTTP_BODY. teamId is appended here so
# callers pass bare paths.
VERCEL_HTTP_STATUS=""
VERCEL_HTTP_BODY=""
vercel_api() {
  method="$1"; path="$2"; body="${3:-}"
  sep='?'
  case "$path" in *\?*) sep='&' ;; esac
  url="${VERCEL_API}${path}${sep}teamId=${VERCEL_TEAM_ID}"
  tmp="$(mktemp)"
  if [ -n "$body" ]; then
    VERCEL_HTTP_STATUS="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer ${VERCEL_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$body" "$url")" || { rm -f "$tmp"; die "curl failed: $method $path"; }
  else
    VERCEL_HTTP_STATUS="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer ${VERCEL_TOKEN}" \
      "$url")" || { rm -f "$tmp"; die "curl failed: $method $path"; }
  fi
  VERCEL_HTTP_BODY="$(cat "$tmp")"
  rm -f "$tmp"
}

api_error_message() {
  printf '%s' "$VERCEL_HTTP_BODY" | jq -r '.error.message // .error.code // "unknown error"' 2>/dev/null || printf 'unparseable error body'
}

# ─── Step 1/8: Idempotency — project must NOT exist ──────────────────────────
log "Step 1/8: Checking that Vercel project '$PROJECT_NAME' does not already exist..."
vercel_api GET "/v9/projects/${PROJECT_NAME}"
if [ "$VERCEL_HTTP_STATUS" = "200" ]; then
  die "Vercel project '$PROJECT_NAME' already exists in team $VERCEL_TEAM_ID. This gym appears to be provisioned. Aborting (nothing was changed)."
elif [ "$VERCEL_HTTP_STATUS" != "404" ]; then
  die "Unexpected response checking project existence (HTTP $VERCEL_HTTP_STATUS): $(api_error_message). Check VERCEL_TOKEN/VERCEL_TEAM_ID."
fi
log "  OK — project name is free."

# ─── Step 2/8: Database (vendor-neutral) ─────────────────────────────────────
log "Step 2/8: Database..."
if [ -n "$DATABASE_URL_ARG" ]; then
  DATABASE_URL="$DATABASE_URL_ARG"
  log "  Using operator-supplied --database-url (vendor-agnostic: Railway, Neon, RDS, ...)."
else
  NEON_BIN=""
  if command -v neonctl >/dev/null 2>&1; then NEON_BIN="neonctl";
  elif command -v neon >/dev/null 2>&1; then NEON_BIN="neon"; fi
  [ -n "$NEON_BIN" ] || die "No --database-url given and neonctl is not installed. Either: (1) create a Postgres on Railway/Neon manually and pass --database-url, or (2) 'npm i -g neonctl' + NEON_API_KEY and re-run."
  log "  Creating Neon project 'traqgym-${SUBDOMAIN}' in region ${NEON_REGION} via ${NEON_BIN}..."
  NEON_OUT="$("$NEON_BIN" projects create --name "traqgym-${SUBDOMAIN}" --region-id "$NEON_REGION" --output json)" \
    || die "neonctl project creation failed (is NEON_API_KEY set / 'neonctl auth' done?)"
  DATABASE_URL="$(printf '%s' "$NEON_OUT" | jq -r '.connection_uris[0].connection_uri // empty')"
  [ -n "$DATABASE_URL" ] || die "Could not parse connection_uri from neonctl output"
  log "  Neon project created."
fi
case "$DATABASE_URL" in
  postgres://*|postgresql://*) : ;;
  *) die "DATABASE_URL does not look like a Postgres URL" ;;
esac

# ─── Step 3/8: Create Vercel project linked to GitHub ────────────────────────
log "Step 3/8: Creating Vercel project '$PROJECT_NAME' linked to ${GITHUB_REPO}..."
CREATE_BODY="$(jq -n \
  --arg name "$PROJECT_NAME" \
  --arg repo "$GITHUB_REPO" \
  --arg rootdir "$ROOT_DIRECTORY" \
  '{name: $name, framework: "nextjs", gitRepository: {type: "github", repo: $repo}}
   + (if $rootdir != "" then {rootDirectory: $rootdir} else {} end)')"
vercel_api POST "/v11/projects" "$CREATE_BODY"
if [ "$VERCEL_HTTP_STATUS" != "200" ] && [ "$VERCEL_HTTP_STATUS" != "201" ]; then
  die "Project creation failed (HTTP $VERCEL_HTTP_STATUS): $(api_error_message). If the GitHub repo is not reachable, install/authorize the team's GitHub integration for ${GITHUB_REPO}."
fi
PROJECT_ID="$(printf '%s' "$VERCEL_HTTP_BODY" | jq -r '.id')"
log "  Project created: $PROJECT_ID"

# ─── Step 4/8: Environment variables ─────────────────────────────────────────
log "Step 4/8: Setting environment variables..."

ENV_JSON='[]'
# add_env <key> <value> <plain|encrypted> — skips empty values (mirrors
# onboard-gym.sh writing every var but only seeding non-empty settings).
add_env() {
  key="$1"; value="$2"; type="$3"
  [ -n "$value" ] || return 0
  ENV_JSON="$(jq -n --argjson arr "$ENV_JSON" --arg k "$key" --arg v "$value" --arg t "$type" \
    '$arr + [{key: $k, value: $v, type: $t, target: ["production", "preview"]}]')"
}

# Core (always set)
add_env DATABASE_URL              "$DATABASE_URL"    encrypted
add_env NEXTAUTH_SECRET           "$NEXTAUTH_SECRET" encrypted
add_env NEXTAUTH_URL              "$NEXTAUTH_URL"    plain
add_env NEXT_PUBLIC_GYM_THEME_HUE "$THEME_HUE"       plain

# Gym identity (same set onboard-gym.sh writes into envs/<subdomain>.env)
add_env NEXT_PUBLIC_GYM_NAME "$GYM_NAME"     plain
add_env GYM_NAME             "$GYM_NAME"     plain
add_env GYM_UPI_VPA          "$GYM_UPI_VPA"  plain
add_env GYM_GSTIN            "$GYM_GSTIN"    plain
add_env GYM_ADDRESS          "$FULL_ADDRESS" plain
add_env GYM_STATE            "$GYM_STATE"    plain
add_env GYM_PHONE            "$GYM_PHONE"    plain
add_env GYM_EMAIL            "$GYM_EMAIL"    plain

# Integrations (optional, encrypted)
add_env MSG91_AUTH_KEY                   "$MSG91_AUTH_KEY"     encrypted
add_env MSG91_WHATSAPP_INTEGRATED_NUMBER "$MSG91_WHATSAPP_NUM" plain
add_env MSG91_SMS_FLOW_ID                "$MSG91_SMS_FLOW_ID"  plain
add_env MSG91_SMS_SENDER_ID              "$MSG91_SMS_SENDER_ID" plain
add_env SMTP_HOST "$SMTP_HOST" plain
add_env SMTP_PORT "$SMTP_PORT" plain
add_env SMTP_USER "$SMTP_USER" plain
add_env SMTP_PASS "$SMTP_PASS" encrypted
add_env SMTP_FROM "$SMTP_FROM" plain
add_env BIOMAX_SDK_BASE_URL "$BIOMAX_URL" plain
add_env BIOMAX_SDK_API_KEY  "$BIOMAX_KEY" encrypted

vercel_api POST "/v10/projects/${PROJECT_ID}/env" "$ENV_JSON"
if [ "$VERCEL_HTTP_STATUS" != "200" ] && [ "$VERCEL_HTTP_STATUS" != "201" ]; then
  die "Setting env vars failed (HTTP $VERCEL_HTTP_STATUS): $(api_error_message). The project was just created so no env should pre-exist; inspect $PROJECT_NAME in the dashboard."
fi
ENV_FAILED="$(printf '%s' "$VERCEL_HTTP_BODY" | jq -r '(.failed // []) | length')"
[ "$ENV_FAILED" = "0" ] || die "Some env vars were rejected: $(printf '%s' "$VERCEL_HTTP_BODY" | jq -c '.failed')"
log "  $(printf '%s' "$ENV_JSON" | jq -r 'length') env vars set (production + preview)."

# ─── Step 5/8: Domain ────────────────────────────────────────────────────────
log "Step 5/8: Adding domain ${GYM_DOMAIN} to project..."
DOMAIN_BODY="$(jq -n --arg name "$GYM_DOMAIN" '{name: $name}')"
vercel_api POST "/v10/projects/${PROJECT_ID}/domains" "$DOMAIN_BODY"
case "$VERCEL_HTTP_STATUS" in
  200|201)
    DOMAIN_VERIFIED="$(printf '%s' "$VERCEL_HTTP_BODY" | jq -r '.verified')"
    log "  Domain added (verified=$DOMAIN_VERIFIED)."
    if [ "$DOMAIN_VERIFIED" != "true" ]; then
      log "  NOTE: domain needs DNS. If ${BASE_DOMAIN} uses Vercel DNS in this team it will verify itself; otherwise add a CNAME: ${GYM_DOMAIN} -> cname.vercel-dns.com"
    fi
    ;;
  409)
    die "Domain ${GYM_DOMAIN} is already assigned to another project in/outside this team: $(api_error_message). Aborting — pick another subdomain or detach the domain first. (Project $PROJECT_NAME was created; delete it before re-running.)"
    ;;
  *)
    die "Adding domain failed (HTTP $VERCEL_HTTP_STATUS): $(api_error_message)"
    ;;
esac

# ─── Step 6/8: Trigger production deploy from main ───────────────────────────
log "Step 6/8: Triggering production deployment of ${GITHUB_REPO}@${GIT_BRANCH}..."
GITHUB_ORG="${GITHUB_REPO%%/*}"
GITHUB_REPO_NAME="${GITHUB_REPO#*/}"
DEPLOY_BODY="$(jq -n \
  --arg name "$PROJECT_NAME" \
  --arg org "$GITHUB_ORG" \
  --arg repo "$GITHUB_REPO_NAME" \
  --arg ref "$GIT_BRANCH" \
  '{name: $name, project: $name, target: "production",
    gitSource: {type: "github", org: $org, repo: $repo, ref: $ref}}')"
vercel_api POST "/v13/deployments" "$DEPLOY_BODY"
if [ "$VERCEL_HTTP_STATUS" != "200" ] && [ "$VERCEL_HTTP_STATUS" != "201" ]; then
  die "Deployment trigger failed (HTTP $VERCEL_HTTP_STATUS): $(api_error_message). If this is a GitHub-integration error, deploy via CI instead: add this project to .github/workflows/auto-deploy-vercel.yml (see KNOWN LIMITATION in this script's header) or run locally: VERCEL_ORG_ID=$VERCEL_TEAM_ID VERCEL_PROJECT_ID=$PROJECT_ID vercel pull --yes --environment=production && vercel build --prod && vercel deploy --prebuilt --prod"
fi
DEPLOY_URL="$(printf '%s' "$VERCEL_HTTP_BODY" | jq -r '.url // empty')"
DEPLOY_ID="$(printf '%s' "$VERCEL_HTTP_BODY" | jq -r '.id // .uid // empty')"
log "  Deployment queued: ${DEPLOY_ID} (https://${DEPLOY_URL})"
log "  Note: the build itself runs 'prisma db push' on production (see package.json build script), so schema lands even before step 7 finishes."

# ─── Step 7/8: Migrate + seed the new database ───────────────────────────────
# Runs locally against the managed Postgres while the Vercel build proceeds
# in parallel.
log "Step 7/8: Running prisma migrate deploy + seeding admin/location/settings..."

(
  cd "$PROJECT_DIR"
  DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy
) || die "prisma migrate deploy failed against the new database"

# Escape single quotes for JS strings (same helper as onboard-gym.sh)
esc() { printf '%s' "$1" | sed "s/'/\\\\'/g"; }

LOCATION_CODE="$(printf '%s' "$SUBDOMAIN" | tr '[:lower:]' '[:upper:]' | head -c 6)"

# SYNC: this seed block is duplicated from scripts/onboard-gym.sh step 6
# (admin worker + default location + GymSettings + integrations). That script
# runs it inside the per-gym docker container; here we run it locally against
# the managed DB. If you change the seed there, change it here too.
(
  cd "$PROJECT_DIR"
  DATABASE_URL="$DATABASE_URL" node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  // Create admin worker
  const hash = await bcrypt.hash('$(esc "$ADMIN_PASSWORD")', 10);
  await prisma.worker.create({
    data: {
      email: '$(esc "$ADMIN_EMAIL")',
      password: hash,
      firstname: 'Admin',
      lastname: '$(esc "$GYM_NAME")',
      role: 'admin',
    },
  });
  console.log('  Admin worker created');

  // Create default location
  await prisma.location.upsert({
    where: { code: '$(esc "$LOCATION_CODE")' },
    create: {
      name: '$(esc "$GYM_NAME")',
      code: '$(esc "$LOCATION_CODE")',
      address: '$(esc "$FULL_ADDRESS")',
      phone: '$(esc "$GYM_PHONE")',
      isActive: true,
    },
    update: {},
  });
  console.log('  Default location created');

  // Seed gym identity settings
  const settings = {
    gym_name: '$(esc "$GYM_NAME")',
    gym_phone: '$(esc "$GYM_PHONE")',
    gym_email: '$(esc "$GYM_EMAIL")',
    gym_address: '$(esc "$FULL_ADDRESS")',
    gym_state: '$(esc "$GYM_STATE")',
    gym_gstin: '$(esc "$GYM_GSTIN")',
    gym_upi_vpa: '$(esc "$GYM_UPI_VPA")',
    grace_period_days: '7',
    auto_checkout_enabled: 'true',
  };

  // Only seed non-empty values
  for (const [key, value] of Object.entries(settings)) {
    if (value) {
      await prisma.gymSettings.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
  }
  console.log('  Gym settings seeded');

  // Seed integration settings if provided
  const integrations = {
    msg91_auth_key: '$(esc "$MSG91_AUTH_KEY")',
    msg91_whatsapp_number: '$(esc "$MSG91_WHATSAPP_NUM")',
    msg91_sms_flow_id: '$(esc "$MSG91_SMS_FLOW_ID")',
    msg91_sms_sender_id: '$(esc "$MSG91_SMS_SENDER_ID")',
    smtp_host: '$(esc "$SMTP_HOST")',
    smtp_port: '$(esc "$SMTP_PORT")',
    smtp_user: '$(esc "$SMTP_USER")',
    smtp_pass: '$(esc "$SMTP_PASS")',
    smtp_from: '$(esc "$SMTP_FROM")',
    biomax_sdk_base_url: '$(esc "$BIOMAX_URL")',
    biomax_sdk_api_key: '$(esc "$BIOMAX_KEY")',
  };

  let integrationCount = 0;
  for (const [key, value] of Object.entries(integrations)) {
    if (value) {
      await prisma.gymSettings.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
      integrationCount++;
    }
  }
  if (integrationCount > 0) {
    console.log('  ' + integrationCount + ' integration setting(s) seeded');
  }
}

main().then(() => prisma.\$disconnect());
"
) || die "Seed failed. If 'Unique constraint failed' on Worker.email: the DB was already seeded — this script is for fresh gyms only."

# ─── Step 8/8: Credentials + checklist ───────────────────────────────────────
log "Step 8/8: Done."
echo ""
echo "========================================="
echo "  Provisioned: $GYM_NAME"
echo "========================================="
echo ""
echo "  URL:        https://${GYM_DOMAIN}"
echo "  Vercel:     project ${PROJECT_NAME} (${PROJECT_ID}), team ${VERCEL_TEAM_ID}"
echo "  Deploys:    ${GITHUB_REPO} @ ${GIT_BRANCH} (branding is env-driven; do NOT create a per-gym branch)"
echo "  Theme hue:  ${THEME_HUE}"
echo "  Admin:      ${ADMIN_EMAIL}"
echo "  Password:   ${ADMIN_PASSWORD}"
echo ""
[ -n "$GYM_PHONE" ]    && echo "  Phone:      $GYM_PHONE"
[ -n "$GYM_EMAIL" ]    && echo "  Email:      $GYM_EMAIL"
[ -n "$FULL_ADDRESS" ] && echo "  Address:    $FULL_ADDRESS"
[ -n "$GYM_GSTIN" ]    && echo "  GSTIN:      $GYM_GSTIN"
[ -n "$GYM_UPI_VPA" ]  && echo "  UPI VPA:    $GYM_UPI_VPA"
echo ""
echo "  Checklist:"
echo "    1. Store the admin credentials in the shared password manager."
echo "       NEVER paste them into repo docs (this repo is public; see CLAUDE.md)."
echo "    2. Wait for the first deployment to finish:"
echo "       https://vercel.com/ -> ${PROJECT_NAME} -> Deployments"
echo "    3. DNS: if ${BASE_DOMAIN} is NOT on Vercel DNS in this team, add"
echo "       CNAME ${GYM_DOMAIN} -> cname.vercel-dns.com and wait for cert."
echo "    4. Log in at https://${GYM_DOMAIN}/login and verify the theme hue"
echo "       (${THEME_HUE}) renders — wrong color means NEXT_PUBLIC_GYM_THEME_HUE"
echo "       was missing at BUILD time; fix env + redeploy."
echo "    5. Upload the gym logo at /admin/settings (no --logo on Vercel)."
echo "    6. Configure plans, staff, and integrations at /admin/settings."
echo "    7. Verify crons appear under the project's Settings -> Cron Jobs"
echo "       (defined in vercel.json)."
echo "    8. Wire ongoing deploys: add ${PROJECT_NAME} (and a"
echo "       VERCEL_$(printf '%s' "$SUBDOMAIN" | tr '[:lower:]' '[:upper:]' | tr -cd 'A-Z0-9')_PROJECT_ID secret) to"
echo "       .github/workflows/auto-deploy-vercel.yml so pushes to ${GIT_BRANCH}"
echo "       redeploy this gym too (the fleet deploys via CI, not Vercel git integration)."
echo ""
