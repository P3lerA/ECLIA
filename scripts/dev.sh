#!/usr/bin/env bash
set -euo pipefail

# ECLIA dev launcher (macOS/Linux).
# Starts both: web console (Vite) + gateway backend.
# Ports/host are read from eclia.config.toml (+ optional eclia.config.local.toml).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pnpm dev:all
