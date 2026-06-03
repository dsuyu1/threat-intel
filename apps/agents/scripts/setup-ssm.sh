#!/usr/bin/env bash
# setup-ssm.sh
# Stores agent secrets in AWS SSM Parameter Store (SecureString).
# Run once before deploying: bash scripts/setup-ssm.sh
#
# Prerequisites:
#   aws cli configured (aws configure)
#   .env.local filled in at repo root

set -euo pipefail

REGION="us-east-1"

put_param() {
  local name="$1"
  local value="$2"
  echo "  → /threat-intel/$name"
  aws ssm put-parameter \
    --region "$REGION" \
    --name "/threat-intel/$name" \
    --value "$value" \
    --type SecureString \
    --overwrite \
    --no-cli-pager
}

# Load .env.local from repo root
ENV_FILE="$(git rev-parse --show-toplevel)/.env.local"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Copy .env.example → .env.local and fill it in."
  exit 1
fi

echo "Loading from $ENV_FILE ..."
# shellcheck disable=SC1090
source "$ENV_FILE"

echo "Writing secrets to SSM Parameter Store (us-east-1)..."
put_param "DATABASE_URL"    "${DATABASE_URL}"
put_param "OPENAI_API_KEY"  "${OPENAI_API_KEY}"
put_param "NVD_API_KEY"     "${NVD_API_KEY:-}"

echo ""
echo "Done. Deploy with: pnpm deploy"
