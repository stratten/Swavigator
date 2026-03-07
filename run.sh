#!/usr/bin/env bash
# Run from anywhere:
#   bash ~/Desktop/Projects/Personal_Projects/Swavigator/run.sh

cd "$(dirname "$0")" || exit 1
lsof -ti:1420 | xargs kill -9 2>/dev/null

# Pre-check Rust compilation so any errors surface early and clearly.
# Cargo is incremental — this is near-instant when nothing has changed.
echo "Checking Rust build..."
(cd src-tauri && cargo check --quiet) || { echo "Rust build check failed."; exit 1; }

npx tauri dev
