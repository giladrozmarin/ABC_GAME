#!/usr/bin/env bash
# One-command start. Loads .env if present, installs deps once, launches the orchestrator + UI.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
[ -d node_modules ] || npm install
exec npx tsx src/cli.ts "${@:-run}"
