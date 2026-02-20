#!/usr/bin/env bash
set -euo pipefail

# Thin wrapper: forward args to the unified Python implementation.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null || { echo "python3 not found" >&2; exit 127; }
exec python3 "$SCRIPT_DIR/sd-t2i.py" "$@"