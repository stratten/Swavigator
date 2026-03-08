# Swavigator

A macOS workspace manager that lives in a compact, always-on-top floating panel. Navigate between Spaces, manage windows, and launch apps — without reaching for Mission Control.

## What It Does

Swavigator gives you a persistent, at-a-glance overview of every Space on every connected display: which Space you're on, what windows are open in each, and a one-click way to jump between them.

### Spaces & Windows

- **See all your Spaces** in a single panel, grouped by display, with live window counts and titles.
- **Label your Spaces** — double-click any space name to give it a memorable label (e.g. "Code", "Comms", "Design"). Labels persist across sessions.
- **Click to navigate** — click a Space to jump to it; click a window to raise and focus it, even if it's on a different Space.
- **Close windows and Spaces** from the panel via right-click context menus.
- **Search** across all Spaces and windows with the built-in search bar.
- **Multi-display aware** — external monitors are labelled separately and each display's Spaces are tracked independently.

### App Launcher

- **Create app groups** — organise frequently used apps into named, collapsible groups (e.g. "Dev Tools", "Browsers").
- **Not just apps** — groups can contain applications, file/folder paths, and URLs.
- **Drag and drop** to reorder apps within a group or reorder groups themselves.
- **App Picker** — browse Dock apps, running apps, or all installed apps and add them to any group.
- **Running indicators** — apps with open windows are highlighted, with badge counts where available.

### View Modes

Four ways to display each Space's contents:

| Mode | Description |
|------|-------------|
| **Compact** | App icons only — minimal footprint. |
| **List** | Full window titles with app icons. |
| **Hybrid** | App icons with window titles on hover. |
| **Count** | Just the window count per Space. |

View modes can be set globally or overridden per Space.

### Panel Behaviour

- **Always on top** — visible across all Spaces.
- **Vertical or horizontal** orientation.
- **Low-opacity idle mode** — the panel fades to near-transparent when your cursor isn't over it, becoming unobtrusive without disappearing entirely. Opacity level is configurable.
- **Global hotkey** — toggle visibility with a configurable shortcut (default: Option+S).
- **Space hotkeys** — Option+1 through Option+9 jump directly to Spaces 1–9.
- **Dock suppression** — optionally hide the macOS Dock entirely and use Swavigator's app launcher instead.
- **Resizable and draggable** — position and size are remembered across sessions.

### Settings

All preferences are accessible from the ⚙ button and persisted to disk:

- View mode, font family, font sizes for space names and window text.
- Panel orientation (vertical/horizontal).
- Dock suppression toggle.
- Running-app highlight toggle.
- Idle-opacity toggle and level.
- Global toggle hotkey binding.
- App tray split percentage.

## macOS Permissions

Swavigator requests three macOS permissions at first launch. All are required for full functionality:

| Permission | Why |
|---|---|
| **Accessibility** | Reading window positions, navigating via AXUIElement, raising windows across Spaces. |
| **Automation** (System Events) | Injecting keyboard shortcuts for Space navigation (Ctrl+1–9), triggering Mission Control and Application Exposé. |
| **Screen Recording** | Reading actual window titles from other apps. Without this, window names appear generic. |

After granting permissions, you may need to restart the app for them to take effect.

## Installation

### From GitHub Releases

1. Download the `.dmg` or `.app.zip` from the [latest release](../../releases/latest).
2. Drag **Swavigator.app** to `/Applications`.
3. Open it. macOS may warn about an unidentified developer — right-click → Open to bypass.
4. Grant the three permissions when prompted.

### From Source

See [Development](#development) below.

## Requirements

- **macOS 12.0** (Monterey) or later.
- Apple Silicon or Intel Mac.

---

## Development

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| **Rust** | stable | Install via [rustup](https://rustup.rs/). |
| **Node.js** | 20+ | Manages the frontend build. |
| **npm** | (bundled with Node) | |
| **Python 3** | 3.9+ | Icon processing only. |
| **Pillow** | any | `pip install Pillow` — used by `scripts/process_icon.py`. |

### Tech Stack

| Layer | Technology |
|---|---|
| Desktop framework | [Tauri 2](https://tauri.app/) |
| Backend | Rust (with Swift scripts for macOS-specific APIs) |
| Frontend | React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| Bundler | Vite 7 |
| macOS APIs | `CGWindowListCopyWindowInfo`, private `CGSCopySpacesForWindows` / `CGSGetActiveSpace`, `AXUIElement`, AppleScript (`osascript`) |

### Project Structure

```
├── src/                     # Frontend (React + TypeScript)
│   ├── components/          # UI components
│   │   ├── FloatingPanel    # Main panel with space/window overview
│   │   ├── SpaceCard        # Individual space rendering
│   │   ├── WindowItem       # Window entry in list/hybrid views
│   │   ├── AppTray          # App launcher groups sidebar
│   │   ├── AppGroupCard     # Individual app group
│   │   ├── AppIcon          # App icon with badge/running indicator
│   │   ├── AppPicker*       # App discovery and selection
│   │   └── SettingsWindow   # Preferences panel
│   ├── hooks/               # React hooks
│   │   ├── useSpaceState    # Polls backend for space/window data
│   │   ├── useAppGroups     # CRUD for app launcher groups
│   │   ├── useAppIcons      # Icon fetching and caching
│   │   └── useHotkeys       # Global hotkey registration
│   └── lib/                 # Shared types and utilities
├── src-tauri/               # Backend (Rust)
│   ├── src/
│   │   ├── lib.rs           # Tauri setup, permissions, dock icon
│   │   ├── commands.rs      # Tauri command handlers
│   │   ├── spaces.rs        # Space enumeration (via Swift/CGS)
│   │   ├── windows.rs       # Window enumeration (via Swift/CG)
│   │   ├── navigator.rs     # Space/window navigation (Swift + AppleScript)
│   │   ├── apps.rs          # App discovery, icons, launching
│   │   └── storage.rs       # Persistent settings and app groups
│   └── icons/               # Generated icon variants
├── scripts/
│   └── process_icon.py      # Icon processing pipeline
├── run.sh                   # Dev mode launcher
├── run-bundle.sh            # Debug .app bundle builder
├── package.sh               # Full local release builder
└── .github/workflows/
    └── release.yml          # CI: build, sign, notarise, release
```

### Running Locally

```bash
# Install dependencies (first time).
npm install

# Dev mode — hot-reloading frontend, Rust recompilation on change.
bash run.sh

# With a clean Rust rebuild (after icon or Cargo.toml changes).
bash run.sh --clean
```

`run.sh` processes the source icon into a dock-ready version, checks the Rust build, then launches `npx tauri dev`.

### Build Scripts

Three scripts handle different build scenarios. All process icons dynamically from the clean source `icon.png` — the source artwork is never modified.

| Script | Purpose | Output |
|---|---|---|
| `run.sh` | Development with hot reload. | Runs in-process (no `.app`). |
| `run-bundle.sh` | Debug `.app` bundle for testing icon rendering, permissions, and packaging behaviour. Version is tagged `-draft`. Installed to `/Applications`. | `/Applications/Swavigator.app` |
| `package.sh` | Full release build. Signs if a Developer ID identity is in the keychain. Notarises if `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` are set. | `.app` + `.dmg` + `.zip` in `src-tauri/target/release/bundle/`. |

```bash
# Debug bundle — approximates release packaging locally.
bash run-bundle.sh
bash run-bundle.sh --clean

# Full release — unsigned local build.
bash package.sh

# Full release — install to /Applications after building.
bash package.sh --install

# Full release — clean build.
bash package.sh --clean --install
```

### Icon Pipeline

The source icon lives at `src-tauri/icons/icon.png` and is **never modified** by any script. All visual processing is applied on the fly by `scripts/process_icon.py`:

1. **Corner cleanup** — replaces white/light corners (from the image generator) with the artwork's dark background.
2. **Border** — draws a warm orange-gold ring along the superellipse contour, just inside the edge.
3. **Squircle mask** — applies macOS-style continuous-corner transparency.
4. **Variant generation** — `npx tauri icon` produces `.icns`, `.ico`, and all required PNG sizes from the processed image.

To update the icon, replace `src-tauri/icons/icon.png` with new artwork and run any build script. The border and mask are re-applied automatically.

### CI / Releases

Pushing a version tag triggers the GitHub Actions release workflow:

```bash
# Bump version in src-tauri/tauri.conf.json, then:
git add -A && git commit -m "v0.3.0: ..."
git tag v0.3.0
git push origin main --tags
```

The workflow builds, signs (if secrets are configured), notarises, and creates a draft GitHub Release with `.dmg` and `.app.zip` assets.

#### Required Secrets (for signed releases)

| Secret | Description |
|---|---|
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` certificate. |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12`. |
| `APPLE_ID` | Apple ID email (for notarisation). |
| `APPLE_PASSWORD` | App-specific password. |
| `APPLE_TEAM_ID` | 10-character team identifier. |

Without these secrets, the workflow still builds — just unsigned and un-notarised.

## Licence

[Apache 2.0](LICENSE)
