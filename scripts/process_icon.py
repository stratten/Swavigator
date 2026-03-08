#!/usr/bin/env python3
"""
Shared icon processing pipeline for Swavigator.

Takes the clean source icon (icon.png) and produces build-ready variants
WITHOUT ever modifying the original. All visual modifications — corner
cleanup, border, squircle mask — are applied to in-memory copies only.

Usage:
    python3 scripts/process_icon.py dock
        → Produces src-tauri/icons/icon-dock.png (squircle-masked, bordered).

    python3 scripts/process_icon.py bundle
        → Produces all icon variants via `npx tauri icon` from a temp
          processed copy, then generates icon-dock.png.

Requires: Pillow (pip install Pillow).
"""

import sys
import os
import shutil
import subprocess
import tempfile
from PIL import Image

# ── Configuration ────────────────────────────────────────────────────────

# Path to the clean source icon (NEVER modified).
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_SOURCE = os.path.join(PROJECT_ROOT, "src-tauri", "icons", "icon.png")
ICON_DOCK_OUT = os.path.join(PROJECT_ROOT, "src-tauri", "icons", "icon-dock.png")

# The dark background colour used in the compass artwork.
BG_COLOR = (23, 26, 33, 255)

# Superellipse exponent — n=5 closely approximates macOS's continuous-corner
# "squircle" shape.
SQUIRCLE_N = 5.0

# Border: warm orange-gold, drawn along the superellipse contour.
# Sits just inside the squircle mask edge — a thin exterior trim.
BORDER_COLOR = (235, 155, 40, 255)
BORDER_RADIUS_PCT = 0.96  # Centre of ring at 96 % of half-width (near edge).
BORDER_THICKNESS_PX = 3   # Pixels each side of the ring centre.

# Corner cleanup: any pixel with per-channel brightness above this threshold
# inside the corner region is replaced with BG_COLOR. Handles the white/light
# corners left by the AI image generator's simulated rounding.
CORNER_BRIGHTNESS_THRESHOLD = 60


# ── Processing steps ─────────────────────────────────────────────────────

def load_source() -> Image.Image:
    """Load the clean source icon into an RGBA PIL Image (1024×1024)."""
    if not os.path.isfile(ICON_SOURCE):
        print(f"  ✗ Source icon not found: {ICON_SOURCE}")
        sys.exit(1)
    img = Image.open(ICON_SOURCE).convert("RGBA")
    # Normalise to 1024×1024 if not already — gives the best quality for
    # downscaling to all required sizes.
    if img.size != (1024, 1024):
        img = img.resize((1024, 1024), Image.LANCZOS)
    return img


def cleanup_corners(img: Image.Image) -> Image.Image:
    """Replace light/white corner pixels with the dark background.

    The AI image generator produces icons with simulated rounded corners on a
    white or near-white background. This step flood-fills those corners with
    the artwork's own dark background so the subsequent squircle mask produces
    clean transparent edges.
    """
    img = img.copy()
    w, h = img.size
    px = img.load()
    hw, hh = w / 2.0, h / 2.0
    n = SQUIRCLE_N

    for y in range(h):
        for x in range(w):
            # Only touch pixels in the "corner zone" — outside the squircle at
            # ~78 % radius. This avoids accidentally altering artwork pixels
            # that happen to be light-coloured.
            dx = abs(x - hw) / hw
            dy = abs(y - hh) / hh
            val = dx ** n + dy ** n
            r_norm = val ** (1.0 / n) if val > 0 else 0

            if r_norm < 0.78:
                continue  # Safely inside the artwork area.

            r, g, b, a = px[x, y]
            # Replace if the pixel is "light" — i.e. close to the white/gray
            # background the image generator used.
            avg_brightness = (r + g + b) / 3.0
            if avg_brightness > CORNER_BRIGHTNESS_THRESHOLD:
                px[x, y] = BG_COLOR
            # Also catch very dark fringe pixels that don't match the bg.
            elif r_norm > 0.95 and avg_brightness < 40:
                # Near the edge AND very dark — safe to replace with bg to
                # avoid fringe artefacts.
                px[x, y] = BG_COLOR

    return img


def draw_border(img: Image.Image) -> Image.Image:
    """Draw a warm orange-gold border ring following the superellipse contour."""
    img = img.copy()
    w, h = img.size
    px = img.load()
    hw, hh = w / 2.0, h / 2.0
    n = SQUIRCLE_N

    inner_r = BORDER_RADIUS_PCT - (BORDER_THICKNESS_PX / hw)
    outer_r = BORDER_RADIUS_PCT + (BORDER_THICKNESS_PX / hw)

    for y in range(h):
        for x in range(w):
            dx = abs(x - hw) / hw
            dy = abs(y - hh) / hh
            if dx == 0 and dy == 0:
                continue
            val = dx ** n + dy ** n
            r_norm = val ** (1.0 / n)

            if inner_r <= r_norm <= outer_r:
                # Anti-alias at the ring edges.
                edge_inner = (r_norm - inner_r) / (BORDER_THICKNESS_PX / hw)
                edge_outer = (outer_r - r_norm) / (BORDER_THICKNESS_PX / hw)
                alpha_factor = min(1.0, edge_inner * 3, edge_outer * 3)

                orig = px[x, y]
                blend_a = int(255 * alpha_factor)
                br, bg_c, bb = BORDER_COLOR[0], BORDER_COLOR[1], BORDER_COLOR[2]

                a_out = blend_a + orig[3] * (255 - blend_a) // 255
                if a_out > 0:
                    r_out = (br * blend_a + orig[0] * orig[3] * (255 - blend_a) // 255) // a_out
                    g_out = (bg_c * blend_a + orig[1] * orig[3] * (255 - blend_a) // 255) // a_out
                    b_out = (bb * blend_a + orig[2] * orig[3] * (255 - blend_a) // 255) // a_out
                    px[x, y] = (min(255, r_out), min(255, g_out), min(255, b_out), min(255, a_out))

    return img


def apply_squircle_mask(img: Image.Image) -> Image.Image:
    """Make corners transparent following the macOS squircle shape."""
    img = img.copy()
    w, h = img.size
    px = img.load()
    hw, hh = w / 2.0, h / 2.0
    n = SQUIRCLE_N

    for y in range(h):
        for x in range(w):
            dx = abs(x - hw) / hw
            dy = abs(y - hh) / hh
            val = dx ** n + dy ** n
            if val > 1.02:
                px[x, y] = (0, 0, 0, 0)
            elif val > 1.0:
                r, g, b, a = px[x, y]
                a = max(0, int(a * (1.02 - val) / 0.02))
                px[x, y] = (r, g, b, a)

    return img


# ── High-level commands ──────────────────────────────────────────────────

def generate_dock_icon():
    """Produce icon-dock.png (used by include_bytes! in lib.rs)."""
    print("  Loading source icon...")
    img = load_source()
    print("  Cleaning up corners...")
    img = cleanup_corners(img)
    print("  Drawing border...")
    img = draw_border(img)
    print("  Applying squircle mask...")
    img = apply_squircle_mask(img)
    img.save(ICON_DOCK_OUT, "PNG")
    print(f"  ✓ {ICON_DOCK_OUT}")


def generate_bundle_icons():
    """Produce ALL icon variants for bundling.

    Writes a fully-processed copy to a temp file, runs `npx tauri icon` to
    regenerate .icns / .ico / PNGs from it, then produces icon-dock.png.
    The clean source icon.png is left completely untouched.
    """
    print("  Loading source icon...")
    img = load_source()

    # Stash the original before tauri icon can overwrite it.
    stash_path = ICON_SOURCE + ".original"
    shutil.copy2(ICON_SOURCE, stash_path)

    print("  Cleaning up corners...")
    img = cleanup_corners(img)
    print("  Drawing border...")
    img = draw_border(img)
    print("  Applying squircle mask...")
    img = apply_squircle_mask(img)

    # Write the processed image to a temp file for tauri icon generation.
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_path = tmp.name
        img.save(tmp_path, "PNG")

    try:
        print("  Running npx tauri icon...")
        result = subprocess.run(
            ["npx", "--yes", "tauri", "icon", tmp_path],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"  ✗ tauri icon failed:\n{result.stderr}")
            sys.exit(1)
        print("  ✓ All icon variants regenerated.")
    finally:
        os.unlink(tmp_path)

    # Restore the clean source — `npx tauri icon` overwrites icon.png.
    shutil.move(stash_path, ICON_SOURCE)
    print("  ✓ Clean source icon.png restored.")

    # Also save as icon-dock.png (the Rust binary embeds this).
    img.save(ICON_DOCK_OUT, "PNG")
    print(f"  ✓ {ICON_DOCK_OUT}")


# ── CLI entry point ──────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("dock", "bundle"):
        print("Usage: python3 scripts/process_icon.py <dock|bundle>")
        print("  dock   — generate icon-dock.png only (for dev mode).")
        print("  bundle — generate ALL icon variants (for packaging).")
        sys.exit(1)

    mode = sys.argv[1]
    print(f"Processing icon ({mode} mode)...")

    if mode == "dock":
        generate_dock_icon()
    elif mode == "bundle":
        generate_bundle_icons()

    print("Done.")
