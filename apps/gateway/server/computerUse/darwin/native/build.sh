#!/bin/bash
# Build eclia-input universal binary (arm64 + x86_64).
# Requires Xcode Command Line Tools.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$SCRIPT_DIR/eclia-input.swift"
OUT="$SCRIPT_DIR/eclia-input"
MIN_MACOS="12.0"

echo "[build] Compiling eclia-input (arm64)..."
swiftc "$SRC" -o "$OUT-arm64" -target "arm64-apple-macosx${MIN_MACOS}" -O

echo "[build] Compiling eclia-input (x86_64)..."
swiftc "$SRC" -o "$OUT-x86_64" -target "x86_64-apple-macosx${MIN_MACOS}" -O

echo "[build] Creating universal binary..."
lipo -create "$OUT-arm64" "$OUT-x86_64" -output "$OUT"
chmod +x "$OUT"

# Clean up single-arch intermediates.
rm -f "$OUT-arm64" "$OUT-x86_64"

echo "[build] Done: $OUT ($(du -h "$OUT" | cut -f1) universal)"
