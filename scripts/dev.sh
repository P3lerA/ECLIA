#!/usr/bin/env bash
set -euo pipefail

# ECLIA dev launcher (macOS/Linux).
# Reads ports/host from eclia.config.toml (+ optional eclia.config.local.toml)
# and starts both: web console (Vite) + demo SSE backend.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/apps/web-console"

pnpm dev:all
