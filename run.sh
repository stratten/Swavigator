#!/usr/bin/env bash
# Run from anywhere:
#   bash ~/Desktop/Projects/Personal_Projects/Swavigator/run.sh
#   bash ~/Desktop/Projects/Personal_Projects/Swavigator/run.sh --clean

cd "$(dirname "$0")" || exit 1
lsof -ti:1420 | xargs kill -9 2>/dev/null

# --clean: wipe Cargo build cache to force a full rebuild (e.g. after icon changes).
if [[ "$1" == "--clean" ]]; then
  echo "Cleaning Cargo build artifacts..."
  (cd src-tauri && cargo clean)
  echo "Clean complete. Rebuilding from scratch (this will take longer)..."
fi

# Generate the squircle-masked, bordered dock icon from the clean source.
# This never modifies icon.png — all processing happens on a copy in memory.
echo "Generating dock icon..."
python3 scripts/process_icon.py dock || { echo "Dock icon generation failed (is Pillow installed?)."; exit 1; }

# Pre-check Rust compilation so any errors surface early and clearly.
# Cargo is incremental — this is near-instant when nothing has changed.
echo "Checking Rust build..."
(cd src-tauri && cargo check --quiet) || { echo "Rust build check failed."; exit 1; }

npx tauri dev
