#!/usr/bin/env bash
# Build a local DEBUG .app bundle and launch it — approximates what the
# packaged release looks like (icon masking, .app behaviour, etc.) without
# shipping to GitHub or waiting for notarisation.
#
# The version is tagged "-draft" (e.g. 0.1.0-draft) to distinguish it from
# a real release build. Visible in Finder → Get Info and the About dialog.
#
# Usage:
#   bash ~/Desktop/Projects/Personal_Projects/Swavigator/run-bundle.sh
#   bash ~/Desktop/Projects/Personal_Projects/Swavigator/run-bundle.sh --clean

cd "$(dirname "$0")" || exit 1

APP_NAME="Swavigator"
BUNDLE_DIR="src-tauri/target/debug/bundle/macos"
APP_PATH="$BUNDLE_DIR/$APP_NAME.app"
INSTALL_PATH="/Applications/$APP_NAME.app"
CONF="src-tauri/tauri.conf.json"

# Kill any running instance.
pkill -f "$APP_NAME.app/Contents/MacOS" 2>/dev/null
lsof -ti:1420 | xargs kill -9 2>/dev/null
sleep 0.5

# --clean: wipe Cargo build cache to force a full rebuild.
if [[ "$1" == "--clean" ]]; then
  echo "Cleaning Cargo build artifacts..."
  (cd src-tauri && cargo clean)
  echo "Clean complete. Rebuilding from scratch (this will take longer)..."
fi

# ── Icon processing ──────────────────────────────────────────────────────
echo "Processing icons..."
python3 scripts/process_icon.py bundle || { echo "Icon processing failed."; exit 1; }

# ── Tag version as draft ─────────────────────────────────────────────────
# Append "-draft" to the version BEFORE building so it's baked into the
# binary and Info.plist naturally (no post-build patching needed).
ORIGINAL_VERSION=$(python3 -c "import json; print(json.load(open('$CONF'))['version'])")
DRAFT_VERSION="${ORIGINAL_VERSION}-draft"
echo "Tagging version as $DRAFT_VERSION..."
python3 -c "
import json
conf = json.load(open('$CONF'))
conf['version'] = '$DRAFT_VERSION'
json.dump(conf, open('$CONF', 'w'), indent=2)
print('  ✓ tauri.conf.json version → $DRAFT_VERSION')
"

# Ensure we restore the original version even if the build fails.
restore_version() {
  python3 -c "
import json
conf = json.load(open('$CONF'))
conf['version'] = '$ORIGINAL_VERSION'
json.dump(conf, open('$CONF', 'w'), indent=2)
" 2>/dev/null
}
trap restore_version EXIT

# ── Build ────────────────────────────────────────────────────────────────
echo "Building frontend..."
npm run build || { echo "Frontend build failed."; exit 1; }

echo "Building .app bundle (debug, unsigned)..."
npx tauri build --debug --bundles app -- --no-default-features 2>&1 | tail -5

if [ ! -d "$APP_PATH" ]; then
  echo "❌ Build failed — $APP_PATH not found."
  exit 1
fi

# ── Install to /Applications ─────────────────────────────────────────────
echo "Installing to $INSTALL_PATH..."
rm -rf "$INSTALL_PATH"
cp -R "$APP_PATH" "$INSTALL_PATH"
xattr -cr "$INSTALL_PATH"

echo ""
echo "✅ Bundle ($DRAFT_VERSION) installed to $INSTALL_PATH"
echo "   Launching..."
echo ""

open "$INSTALL_PATH"
