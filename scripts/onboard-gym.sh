#!/bin/bash
# Onboard a new gym instance to TraqGym
#
# Usage:
#   ./scripts/onboard-gym.sh "EGym Lokhandwala" egymlokhandwala admin@egym.com [options]
#
# Required:
#   $1  Gym name
#   $2  Subdomain (lowercase, no spaces)
#   $3  Admin email
#
# Options (gym identity):
#   --phone        Gym contact phone (e.g., "+919876543210")
#   --email        Gym contact email (e.g., "info@egym.com")
#   --address      Full address (e.g., "123 Link Road, Lokhandwala, Andheri West")
#   --city         City (e.g., "Mumbai")
#   --state        State (default: "Maharashtra")
#   --pincode      PIN code (e.g., "400053")
#   --gstin        GSTIN number
#   --upi          UPI VPA (default: <subdomain>@upi)
#   --logo         Path to logo file (PNG/JPEG/SVG/WebP, max 2MB)
#
# Options (integrations — can also be set later via /admin/settings):
#   --msg91-key          MSG91 auth key
#   --msg91-whatsapp     MSG91 WhatsApp integrated number
#   --msg91-sms-flow     MSG91 SMS flow ID
#   --msg91-sender       MSG91 SMS sender ID
#   --smtp-host          SMTP host
#   --smtp-port          SMTP port (default: 587)
#   --smtp-user          SMTP username
#   --smtp-pass          SMTP password
#   --smtp-from          SMTP from address
#   --biomax-url         BioMax SDK base URL
#   --biomax-key         BioMax SDK API key
#
# Example:
#   ./scripts/onboard-gym.sh "Free Form Fitness" freeformfitness admin@freeformfitness.com \
#     --phone "+919876543210" \
#     --email "info@freeformfitness.com" \
#     --address "2nd Floor, ABC Complex, MG Road" \
#     --city "Pune" \
#     --state "Maharashtra" \
#     --pincode "411001" \
#     --gstin "27AABCU9603R1ZM" \
#     --logo "/path/to/logo.png"

set -euo pipefail

if [ $# -lt 3 ]; then
  echo "Usage: $0 <gym-name> <subdomain> <admin-email> [options]"
  echo ""
  echo "Required:"
  echo "  \$1  Gym name          (e.g., \"EGym Andheri\")"
  echo "  \$2  Subdomain         (e.g., egymandheri)"
  echo "  \$3  Admin email       (e.g., admin@egymandheri.com)"
  echo ""
  echo "Options:"
  echo "  --phone <number>       Gym contact phone"
  echo "  --email <email>        Gym contact email"
  echo "  --address <address>    Full street address"
  echo "  --city <city>          City"
  echo "  --state <state>        State (default: Maharashtra)"
  echo "  --pincode <pin>        PIN code"
  echo "  --gstin <gstin>        GSTIN number"
  echo "  --upi <vpa>            UPI VPA (default: <subdomain>@upi)"
  echo "  --logo <path>          Path to logo file (PNG/JPEG/SVG/WebP)"
  echo ""
  echo "  --msg91-key <key>      MSG91 auth key"
  echo "  --msg91-whatsapp <num> MSG91 WhatsApp number"
  echo "  --msg91-sms-flow <id>  MSG91 SMS flow ID"
  echo "  --msg91-sender <id>    MSG91 SMS sender ID"
  echo "  --smtp-host <host>     SMTP host"
  echo "  --smtp-port <port>     SMTP port (default: 587)"
  echo "  --smtp-user <user>     SMTP username"
  echo "  --smtp-pass <pass>     SMTP password"
  echo "  --smtp-from <email>    SMTP from address"
  echo "  --biomax-url <url>     BioMax SDK base URL"
  echo "  --biomax-key <key>     BioMax SDK API key"
  exit 1
fi

GYM_NAME="$1"
SUBDOMAIN="$2"
ADMIN_EMAIL="$3"
shift 3

# Defaults
GYM_PHONE=""
GYM_EMAIL=""
GYM_ADDRESS=""
GYM_CITY=""
GYM_STATE="Maharashtra"
GYM_PINCODE=""
GYM_GSTIN=""
GYM_UPI_VPA="${SUBDOMAIN}@upi"
GYM_LOGO=""

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

# Parse named options
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
    --logo)         GYM_LOGO="$2"; shift 2 ;;
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
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Validate logo file if provided
if [ -n "$GYM_LOGO" ]; then
  if [ ! -f "$GYM_LOGO" ]; then
    echo "Error: Logo file not found: $GYM_LOGO"
    exit 1
  fi
  LOGO_SIZE=$(wc -c < "$GYM_LOGO")
  if [ "$LOGO_SIZE" -gt 2097152 ]; then
    echo "Error: Logo file exceeds 2MB limit"
    exit 1
  fi
  LOGO_EXT="${GYM_LOGO##*.}"
  LOGO_EXT_LOWER=$(echo "$LOGO_EXT" | tr '[:upper:]' '[:lower:]')
  case "$LOGO_EXT_LOWER" in
    png|jpg|jpeg|svg|webp) ;;
    *) echo "Error: Logo must be PNG, JPEG, SVG, or WebP (got .$LOGO_EXT_LOWER)"; exit 1 ;;
  esac
fi

# Build full address string from parts
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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/envs/${SUBDOMAIN}.env"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"
CADDYFILE="$PROJECT_DIR/Caddyfile"
ADMIN_PASSWORD=$(openssl rand -base64 12)
NEXTAUTH_SECRET=$(openssl rand -base64 32)
PG_PASSWORD=$(openssl rand -base64 16)

# Check if env file already exists
if [ -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE already exists. Gym may already be onboarded."
  exit 1
fi

# Find next available port (scan compose file for highest app port)
LAST_PORT=$(grep -oP '"\K\d+(?=:3000")' "$COMPOSE_FILE" 2>/dev/null | sort -n | tail -1)
NEXT_PORT=$((LAST_PORT + 1))

echo "=== Onboarding: $GYM_NAME ==="
echo "Subdomain: ${SUBDOMAIN}.traqgym.com"
echo "Admin:     $ADMIN_EMAIL"
echo "App port:  $NEXT_PORT"
[ -n "$GYM_PHONE" ]   && echo "Phone:     $GYM_PHONE"
[ -n "$GYM_EMAIL" ]   && echo "Email:     $GYM_EMAIL"
[ -n "$FULL_ADDRESS" ] && echo "Address:   $FULL_ADDRESS"
[ -n "$GYM_STATE" ]   && echo "State:     $GYM_STATE"
[ -n "$GYM_GSTIN" ]   && echo "GSTIN:     $GYM_GSTIN"
[ -n "$GYM_UPI_VPA" ] && echo "UPI VPA:   $GYM_UPI_VPA"
[ -n "$GYM_LOGO" ]    && echo "Logo:      $GYM_LOGO"
echo ""

# 1. Generate env file
echo "Step 1/8: Creating $ENV_FILE..."
mkdir -p "$PROJECT_DIR/envs"
cat > "$ENV_FILE" << EOF
# $GYM_NAME
DATABASE_URL="postgresql://postgres:${PG_PASSWORD}@pg-${SUBDOMAIN}:5432/traqgym_${SUBDOMAIN}?schema=public"
NEXTAUTH_SECRET="${NEXTAUTH_SECRET}"
NEXTAUTH_URL="https://${SUBDOMAIN}.traqgym.com"

NEXT_PUBLIC_GYM_NAME="${GYM_NAME}"
GYM_NAME="${GYM_NAME}"
GYM_UPI_VPA=${GYM_UPI_VPA}
GYM_GSTIN=${GYM_GSTIN}
GYM_ADDRESS=${FULL_ADDRESS}
GYM_STATE=${GYM_STATE}
GYM_PHONE=${GYM_PHONE}
GYM_EMAIL=${GYM_EMAIL}

MSG91_AUTH_KEY=${MSG91_AUTH_KEY}
MSG91_WHATSAPP_INTEGRATED_NUMBER=${MSG91_WHATSAPP_NUM}
MSG91_SMS_FLOW_ID=${MSG91_SMS_FLOW_ID}
MSG91_SMS_SENDER_ID=${MSG91_SMS_SENDER_ID}

SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
SMTP_FROM=${SMTP_FROM}

BIOMAX_SDK_BASE_URL=${BIOMAX_URL}
BIOMAX_SDK_API_KEY=${BIOMAX_KEY}
EOF

# 2. Append services to docker-compose.prod.yml (before volumes section)
echo "Step 2/8: Adding services to docker-compose.prod.yml..."
# Insert before the "volumes:" line at the end
sed -i.bak "/^volumes:/i\\
\\
  # --- ${GYM_NAME} ---\\
  pg-${SUBDOMAIN}:\\
    image: postgres:16\\
    container_name: traqgym-pg-${SUBDOMAIN}\\
    environment:\\
      POSTGRES_DB: traqgym_${SUBDOMAIN}\\
      POSTGRES_USER: postgres\\
      POSTGRES_PASSWORD: ${PG_PASSWORD}\\
    volumes:\\
      - pgdata-${SUBDOMAIN}:/var/lib/postgresql/data\\
    networks:\\
      - traqgym\\
    healthcheck:\\
      test: [\"CMD-SHELL\", \"pg_isready -U postgres\"]\\
      interval: 10s\\
      timeout: 5s\\
      retries: 5\\
\\
  migrate-${SUBDOMAIN}:\\
    build: .\\
    command: npx prisma migrate deploy\\
    env_file: ./envs/${SUBDOMAIN}.env\\
    depends_on:\\
      pg-${SUBDOMAIN}:\\
        condition: service_healthy\\
    networks:\\
      - traqgym\\
\\
  app-${SUBDOMAIN}:\\
    build: .\\
    container_name: traqgym-app-${SUBDOMAIN}\\
    ports:\\
      - \"${NEXT_PORT}:3000\"\\
    env_file: ./envs/${SUBDOMAIN}.env\\
    depends_on:\\
      migrate-${SUBDOMAIN}:\\
        condition: service_completed_successfully\\
    networks:\\
      - traqgym\\
    healthcheck:\\
      test: [\"CMD\", \"wget\", \"-qO-\", \"http://localhost:3000/api/health\"]\\
      interval: 30s\\
      timeout: 5s\\
      retries: 3\\
" "$COMPOSE_FILE"

# Add volume for new gym DB
sed -i.bak "/^  caddy_config:/a\\
  pgdata-${SUBDOMAIN}:" "$COMPOSE_FILE"

# Clean up sed backup files
rm -f "$COMPOSE_FILE.bak"

# 3. Append Caddyfile block
echo "Step 3/8: Adding Caddy routing..."
cat >> "$CADDYFILE" << EOF

${SUBDOMAIN}.traqgym.com {
	reverse_proxy app-${SUBDOMAIN}:3000
}
EOF

# 4. Start new services
echo "Step 4/8: Starting services..."
docker compose -f "$COMPOSE_FILE" up -d "pg-${SUBDOMAIN}" "migrate-${SUBDOMAIN}" "app-${SUBDOMAIN}"

# 5. Wait for migration to complete
echo "Step 5/8: Waiting for migration..."
docker compose -f "$COMPOSE_FILE" wait "migrate-${SUBDOMAIN}" 2>/dev/null || sleep 10

# 6. Seed admin account + gym identity settings
echo "Step 6/8: Creating admin account & seeding gym settings..."

# Escape single quotes for JS strings
esc() { echo "$1" | sed "s/'/\\\\'/g"; }

docker compose -f "$COMPOSE_FILE" exec "app-${SUBDOMAIN}" node -e "
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
    where: { code: '$(echo "$SUBDOMAIN" | tr '[:lower:]' '[:upper:]' | head -c 6)' },
    create: {
      name: '$(esc "$GYM_NAME")',
      code: '$(echo "$SUBDOMAIN" | tr '[:lower:]' '[:upper:]' | head -c 6)',
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

# 7. Copy logo if provided
if [ -n "$GYM_LOGO" ]; then
  echo "Step 7/8: Uploading logo..."
  LOGO_EXT="${GYM_LOGO##*.}"
  LOGO_EXT_LOWER=$(echo "$LOGO_EXT" | tr '[:upper:]' '[:lower:]')
  LOGO_DEST="/app/public/uploads/gym-logo.${LOGO_EXT_LOWER}"
  LOGO_PATH="/uploads/gym-logo.${LOGO_EXT_LOWER}"

  # Copy logo into the running container
  docker cp "$GYM_LOGO" "traqgym-app-${SUBDOMAIN}:${LOGO_DEST}"

  # Update gym_logo setting in DB
  docker compose -f "$COMPOSE_FILE" exec "app-${SUBDOMAIN}" node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  await prisma.gymSettings.upsert({
    where: { key: 'gym_logo' },
    create: { key: 'gym_logo', value: '${LOGO_PATH}' },
    update: { value: '${LOGO_PATH}' },
  });
  console.log('  Logo saved: ${LOGO_PATH}');
}
main().then(() => prisma.\$disconnect());
"
else
  echo "Step 7/8: No logo provided, skipping..."
fi

# 8. Reload Caddy
echo "Step 8/8: Reloading Caddy..."
docker compose -f "$COMPOSE_FILE" exec caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || echo "  Caddy reload skipped (may need manual restart)"

echo ""
echo "========================================="
echo "  Onboarding Complete: $GYM_NAME"
echo "========================================="
echo ""
echo "  URL:      https://${SUBDOMAIN}.traqgym.com"
echo "  Admin:    $ADMIN_EMAIL"
echo "  Password: $ADMIN_PASSWORD"
echo ""
[ -n "$GYM_PHONE" ]    && echo "  Phone:    $GYM_PHONE"
[ -n "$GYM_EMAIL" ]    && echo "  Email:    $GYM_EMAIL"
[ -n "$FULL_ADDRESS" ] && echo "  Address:  $FULL_ADDRESS"
[ -n "$GYM_STATE" ]    && echo "  State:    $GYM_STATE"
[ -n "$GYM_GSTIN" ]    && echo "  GSTIN:    $GYM_GSTIN"
[ -n "$GYM_UPI_VPA" ]  && echo "  UPI VPA:  $GYM_UPI_VPA"
[ -n "$GYM_LOGO" ]     && echo "  Logo:     uploaded"
echo ""
echo "  DNS: Ensure A record exists for ${SUBDOMAIN}.traqgym.com"
echo "       (or use wildcard *.traqgym.com)"
echo ""
echo "  Next steps:"
echo "    1. Share credentials with the gym owner"
[ -z "$GYM_LOGO" ]  && echo "    2. Upload logo at /admin/settings"
[ -z "$GYM_PHONE" ] && echo "    3. Add phone number at /admin/settings"
[ -z "$GYM_GSTIN" ] && echo "    4. Add GSTIN at /admin/settings"
echo "    5. Configure plans, staff, and integrations"
echo ""
