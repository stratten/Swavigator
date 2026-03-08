//! App discovery, icon fetching, and launching commands.
//!
//! This module handles:
//! - Fetching app icons (single and batch)
//! - Discovering apps from Dock, running processes, and installed applications
//! - Launching apps, opening paths/URLs
//! - Badge counts and Dock menu integration

use serde::Serialize;
use std::collections::HashMap;

use crate::apps;

// ---------------------------------------------------------------------------
// App icon commands
// ---------------------------------------------------------------------------

/// Get an application's icon as a base64-encoded PNG, given its bundle ID.
///
/// Uses NSWorkspace to look up the app by bundle ID, render its icon to a
/// 32×32 PNG, and return it as a data URI.
#[tauri::command]
pub fn get_app_icon(bundle_id: String) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        get_app_icon_macos(&bundle_id)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = bundle_id;
        Err("App icons are only available on macOS.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn get_app_icon_macos(bundle_id: &str) -> Result<String, String> {
    let swift_src = format!(
        r#"
import Cocoa
import Foundation

let bundleId = "{bundle_id}"

guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {{
    fputs("ERR: App not found for bundle ID: \(bundleId)\n", stderr)
    exit(1)
}}

let icon = NSWorkspace.shared.icon(forFile: url.path)
icon.size = NSSize(width: 32, height: 32)

let bitmapRep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: 32,
    pixelsHigh: 32,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
)!

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmapRep)
icon.draw(in: NSRect(x: 0, y: 0, width: 32, height: 32))
NSGraphicsContext.restoreGraphicsState()

guard let pngData = bitmapRep.representation(using: .png, properties: [:]) else {{
    fputs("ERR: Failed to create PNG.\n", stderr)
    exit(1)
}}

print(pngData.base64EncodedString())
"#
    );

    let output = std::process::Command::new("swift")
        .arg("-e")
        .arg(&swift_src)
        .output()
        .map_err(|e| format!("Failed to run Swift: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Icon lookup failed: {}", stderr));
    }

    let b64 = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(format!("data:image/png;base64,{b64}"))
}

/// Fetch icons for many bundle IDs in a single Swift process.
/// Returns a map of bundle_id → data:image/png;base64,… URIs.
#[cfg(target_os = "macos")]
fn batch_get_app_icons(bundle_ids: &[&str]) -> Result<HashMap<String, String>, String> {
    use std::io::Write;

    if bundle_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Build a Swift script that reads bundle IDs from stdin (one per line),
    // looks up each icon, and prints JSON: {"bundleId": "base64...", ...}
    let swift_src = r#"
import Cocoa
import Foundation

// Read all bundle IDs from stdin.
var bundleIds: [String] = []
while let line = readLine() {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty {
        bundleIds.append(trimmed)
    }
}

var results: [String: String] = [:]

for bundleId in bundleIds {
    guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
        continue
    }

    let icon = NSWorkspace.shared.icon(forFile: url.path)
    icon.size = NSSize(width: 32, height: 32)

    guard let bitmapRep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: 32,
        pixelsHigh: 32,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        continue
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmapRep)
    icon.draw(in: NSRect(x: 0, y: 0, width: 32, height: 32))
    NSGraphicsContext.restoreGraphicsState()

    guard let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
        continue
    }

    results[bundleId] = pngData.base64EncodedString()
}

// Output as JSON.
if let jsonData = try? JSONSerialization.data(withJSONObject: results, options: []),
   let jsonString = String(data: jsonData, encoding: .utf8) {
    print(jsonString)
} else {
    fputs("ERR: Failed to serialize JSON\n", stderr)
    Darwin.exit(1)
}
"#;

    let mut child = std::process::Command::new("swift")
        .arg("-e")
        .arg(swift_src)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn Swift: {e}"))?;

    // Write all bundle IDs to stdin.
    if let Some(ref mut stdin) = child.stdin {
        for bid in bundle_ids {
            let _ = writeln!(stdin, "{}", bid);
        }
    }
    // Drop stdin so Swift sees EOF.
    drop(child.stdin.take());

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for Swift: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Batch icon fetch failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let json: HashMap<String, String> =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse icon JSON: {e}"))?;

    // Convert raw base64 to data URIs.
    let result: HashMap<String, String> = json
        .into_iter()
        .map(|(k, v)| (k, format!("data:image/png;base64,{v}")))
        .collect();

    Ok(result)
}

// ---------------------------------------------------------------------------
// App discovery commands
// ---------------------------------------------------------------------------

/// Read dock items from the user's Dock plist.
#[tauri::command]
pub fn get_dock_apps() -> Result<Vec<apps::DiscoverableApp>, String> {
    apps::get_dock_apps()
}

/// List all installed applications.
#[tauri::command]
pub fn get_installed_apps() -> Result<Vec<apps::DiscoverableApp>, String> {
    apps::get_installed_apps()
}

/// List currently running GUI applications.
#[tauri::command]
pub fn get_running_apps() -> Result<Vec<apps::DiscoverableApp>, String> {
    apps::get_running_apps()
}

/// A discoverable app bundled with its icon (base64 data URI).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverableAppWithIcon {
    pub bundle_id: String,
    pub name: String,
    pub icon: String,
    /// Sources this app was discovered from: "dock", "running", "installed".
    pub sources: Vec<String>,
}

/// Return all discoverable apps (dock + running + installed) with their icons
/// pre-fetched in a single call. Icons are batch-fetched in one Swift process
/// to avoid spawning hundreds of subprocesses.
#[tauri::command]
pub fn get_all_discoverable_apps() -> Result<Vec<DiscoverableAppWithIcon>, String> {
    let t0 = std::time::Instant::now();
    log::info!("[cmd] get_all_discoverable_apps: starting");

    let dock = apps::get_dock_apps().unwrap_or_default();
    log::info!(
        "[cmd] get_all_discoverable_apps: {} dock apps ({:.0?})",
        dock.len(),
        t0.elapsed()
    );

    let running = apps::get_running_apps().unwrap_or_default();
    log::info!(
        "[cmd] get_all_discoverable_apps: {} running apps ({:.0?})",
        running.len(),
        t0.elapsed()
    );

    let installed = apps::get_installed_apps().unwrap_or_default();
    log::info!(
        "[cmd] get_all_discoverable_apps: {} installed apps ({:.0?})",
        installed.len(),
        t0.elapsed()
    );

    // De-duplicate by bundle ID, preserving source priority: dock > running > installed.
    let mut seen: HashMap<String, DiscoverableAppWithIcon> = HashMap::new();

    // Helper: insert or merge the source tag for an existing entry.
    let mut insert = |bundle_id: String, name: String, source: &str| {
        seen.entry(bundle_id.clone())
            .and_modify(|e| {
                if !e.sources.contains(&source.to_string()) {
                    e.sources.push(source.to_string());
                }
            })
            .or_insert(DiscoverableAppWithIcon {
                bundle_id,
                name,
                icon: String::new(),
                sources: vec![source.to_string()],
            });
    };

    for app in dock {
        insert(app.bundle_id, app.name, "dock");
    }
    for app in running {
        insert(app.bundle_id, app.name, "running");
    }
    for app in installed {
        insert(app.bundle_id, app.name, "installed");
    }

    let mut result: Vec<DiscoverableAppWithIcon> = seen.into_values().collect();
    log::info!(
        "[cmd] get_all_discoverable_apps: {} unique apps after dedup ({:.0?})",
        result.len(),
        t0.elapsed()
    );

    // Batch-fetch ALL icons in a single Swift process.
    let bundle_ids: Vec<&str> = result.iter().map(|e| e.bundle_id.as_str()).collect();
    log::info!(
        "[cmd] get_all_discoverable_apps: fetching icons for {} apps…",
        bundle_ids.len()
    );

    #[cfg(target_os = "macos")]
    match batch_get_app_icons(&bundle_ids) {
        Ok(icon_map) => {
            log::info!(
                "[cmd] get_all_discoverable_apps: got {} icons ({:.0?})",
                icon_map.len(),
                t0.elapsed()
            );
            for entry in &mut result {
                if let Some(data_uri) = icon_map.get(&entry.bundle_id) {
                    entry.icon = data_uri.clone();
                }
            }
        }
        Err(e) => {
            log::warn!(
                "[cmd] get_all_discoverable_apps: batch icon fetch failed: {} ({:.0?})",
                e,
                t0.elapsed()
            );
            // Icons stay empty — the UI will show letter placeholders.
        }
    }

    // Sort by name for consistent ordering.
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    log::info!(
        "[cmd] get_all_discoverable_apps: done — {} apps total ({:.0?})",
        result.len(),
        t0.elapsed()
    );
    Ok(result)
}

// ---------------------------------------------------------------------------
// App launching commands
// ---------------------------------------------------------------------------

/// Launch or activate an application by bundle ID.
#[tauri::command]
pub fn launch_app(bundle_id: String) -> Result<(), String> {
    log::info!("[cmd] launch_app: bundle='{}'", bundle_id);
    apps::launch_app(&bundle_id)
}

/// Open a file or folder by its absolute path.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    log::info!("[cmd] open_path: path='{}'", path);
    apps::open_path(&path)
}

/// Open a URL in the default browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    log::info!("[cmd] open_url: url='{}'", url);
    apps::open_url(&url)
}

/// Get a base64-encoded PNG icon for a file or folder path.
#[tauri::command]
pub fn get_path_icon(path: String) -> Result<String, String> {
    apps::get_path_icon(&path)
}

/// Get badge counts for a list of app names (display names as shown in Dock).
#[tauri::command]
pub fn get_app_badge_counts(app_names: Vec<String>) -> Result<Vec<apps::AppBadge>, String> {
    apps::get_app_badge_counts(&app_names)
}

/// Show the real Dock right-click context menu for an app by its display name.
#[tauri::command]
pub fn show_dock_menu(app_name: String) -> Result<(), String> {
    log::info!("[cmd] show_dock_menu: app='{}'", app_name);
    apps::show_dock_menu(&app_name)
}
