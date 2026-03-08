#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Local release packaging for Swavigator.
#
# Produces a RELEASE-quality .app bundle and .dmg — the same artefacts the
# GitHub Actions workflow creates, but built locally. Use this to validate
# the full packaging pipeline without pushing a tag and waiting for CI.
#
# Code-signing and notarisation are attempted if the required environment
# variables / keychain identities are present. Otherwise the build proceeds
# unsigned (perfectly fine for local testing).
#
# Outputs:
#   src-tauri/target/release/bundle/macos/Swavigator.app
#   src-tauri/target/release/bundle/dmg/Swavigator_<version>_aarch64.dmg
#   (optionally) Swavigator.app.zip alongside the .app
#
# Usage:
#   bash ~/Desktop/Projects/Personal_Projects/Swavigator/package.sh
#   bash ~/Desktop/Projects/Personal_Projects/Swavigator/package.sh --clean
#   bash ~/Desktop/Projects/Personal_Projects/Swavigator/package.sh --install
#
# Flags:
#   --clean    Wipe Cargo build cache before building (slow but thorough).
#   --install  After building, install the .app to /Applications.
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail
cd "$(dirname "$0")" || exit 1

APP_NAME="Swavigator"
BUNDLE_DIR="src-tauri/target/release/bundle"
APP_DIR="$BUNDLE_DIR/macos"
DMG_DIR="$BUNDLE_DIR/dmg"

CLEAN=false
INSTALL=false

for arg in "$@"; do
  case "$arg" in
    --clean)   CLEAN=true ;;
    --install) INSTALL=true ;;
    *)         echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# Kill any running instance so the build doesn't collide.
pkill -f "$APP_NAME.app/Contents/MacOS" 2>/dev/null || true
lsof -ti:1420 | xargs kill -9 2>/dev/null || true
sleep 0.3

# ── Clean (optional) ────────────────────────────────────────────────────
if $CLEAN; then
  echo "Cleaning Cargo build artefacts..."
  (cd src-tauri && cargo clean)
  echo "Clean complete."
fi

# ── Icon processing ─────────────────────────────────────────────────────
# Process the clean source icon → all bundle variants + dock icon.
# The source icon.png is never modified.
echo ""
echo "═══ Icon Processing ═══"
python3 scripts/process_icon.py bundle || { echo "Icon processing failed."; exit 1; }

# ── Frontend ─────────────────────────────────────────────────────────────
echo ""
echo "═══ Frontend Build ═══"
npm run build || { echo "Frontend build failed."; exit 1; }

# ── Tauri release build ─────────────────────────────────────────────────
echo ""
echo "═══ Tauri Release Build ═══"

# Check for signing identity. If present, Tauri will sign automatically.
if security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID"; then
  echo "  Code-signing identity found — build will be signed."
else
  echo "  No code-signing identity found — build will be unsigned."
fi

npm run tauri build 2>&1

# ── Locate outputs ──────────────────────────────────────────────────────
APP_PATH=$(find "$APP_DIR" -name "*.app" -maxdepth 1 2>/dev/null | head -1)
DMG_PATH=$(find "$DMG_DIR" -name "*.dmg" 2>/dev/null | head -1)

echo ""
echo "═══ Build Outputs ═══"

if [ -d "$APP_PATH" ]; then
  APP_SIZE=$(du -sh "$APP_PATH" | cut -f1)
  echo "  ✅ .app:  $APP_PATH  ($APP_SIZE)"

  # Create a zip alongside the .app (same as the CI workflow).
  APP_ZIP="${APP_PATH}.zip"
  ditto -c -k --keepParent "$APP_PATH" "$APP_ZIP" 2>/dev/null
  if [ -f "$APP_ZIP" ]; then
    ZIP_SIZE=$(du -sh "$APP_ZIP" | cut -f1)
    echo "  ✅ .zip:  $APP_ZIP  ($ZIP_SIZE)"
  fi
else
  echo "  ❌ .app not found in $APP_DIR"
  exit 1
fi

if [ -n "$DMG_PATH" ] && [ -f "$DMG_PATH" ]; then
  DMG_SIZE=$(du -sh "$DMG_PATH" | cut -f1)
  echo "  ✅ .dmg:  $DMG_PATH  ($DMG_SIZE)"
else
  echo "  ⚠️  .dmg not found (this is normal for some build configurations)."
fi

# ── Notarisation (if credentials available) ──────────────────────────────
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  if [ -n "$DMG_PATH" ] && [ -f "$DMG_PATH" ]; then
    echo ""
    echo "═══ Notarisation ═══"
    echo "  Submitting $DMG_PATH..."
    xcrun notarytool submit "$DMG_PATH" \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_PASSWORD" \
      --team-id "$APPLE_TEAM_ID" \
      --wait

    echo "  Stapling..."
    xcrun stapler staple "$DMG_PATH"
    echo "  ✅ Notarisation complete."
  fi
else
  echo ""
  echo "  ℹ️  Notarisation skipped (set APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID to enable)."
fi

# ── Install (optional) ──────────────────────────────────────────────────
if $INSTALL; then
  INSTALL_PATH="/Applications/$APP_NAME.app"
  echo ""
  echo "═══ Installing to /Applications ═══"
  rm -rf "$INSTALL_PATH"
  cp -R "$APP_PATH" "$INSTALL_PATH"
  xattr -cr "$INSTALL_PATH"
  echo "  ✅ Installed to $INSTALL_PATH"
  echo "  Launching..."
  open "$INSTALL_PATH"
fi

echo ""
echo "Done."
