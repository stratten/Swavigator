use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{apps, navigator, spaces, storage, windows};

// ---------------------------------------------------------------------------
// Cursor position (for hover detection on unfocused windows)
// ---------------------------------------------------------------------------

/// Returns the global cursor position (x, y) in screen coordinates.
/// Uses CoreGraphics FFI directly — no external crate needed.
#[tauri::command]
pub fn get_cursor_position() -> Result<(f64, f64), String> {
    #[cfg(target_os = "macos")]
    {
        #[repr(C)]
        #[derive(Copy, Clone)]
        struct CGPoint {
            x: f64,
            y: f64,
        }

        type CGEventRef = *const std::ffi::c_void;

        extern "C" {
            fn CGEventCreate(source: *const std::ffi::c_void) -> CGEventRef;
            fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
            fn CFRelease(cf: *const std::ffi::c_void);
        }

        unsafe {
            let event = CGEventCreate(std::ptr::null());
            if event.is_null() {
                return Err("Failed to create CGEvent".into());
            }
            let point = CGEventGetLocation(event);
            CFRelease(event);
            Ok((point.x, point.y))
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Not supported on this platform".into())
    }
}

// ---------------------------------------------------------------------------
// Frontend → terminal logging
// ---------------------------------------------------------------------------

/// Allows the frontend to log messages to the terminal (via the Rust logger).
#[tauri::command]
pub fn log_from_frontend(level: String, message: String) {
    match level.as_str() {
        "warn" => log::warn!("[fe] {}", message),
        "error" => log::error!("[fe] {}", message),
        _ => log::info!("[fe] {}", message),
    }
}

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

/// Combined space + window state emitted to the frontend every poll cycle.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpaceStatePayload {
    pub spaces: Vec<SpaceWithWindows>,
    pub active_space_id: i64,
    pub timestamp: i64,
}

/// A single space with its windows and user-assigned label.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpaceWithWindows {
    pub space_id: i64,
    pub space_index: usize,
    pub display_id: String,
    pub label: String,
    pub is_active: bool,
    pub is_visible: bool,
    pub is_collapsed: bool,
    pub is_builtin_display: bool,
    pub windows: Vec<windows::WindowInfo>,
}

// ---------------------------------------------------------------------------
// Tauri commands (invoked from the frontend)
// ---------------------------------------------------------------------------

/// Get the current space and window state (one-shot, for initial load).
#[tauri::command]
pub fn get_space_state() -> Result<SpaceStatePayload, String> {
    build_state_payload().ok_or_else(|| "Failed to enumerate spaces.".to_string())
}

/// Set a label for a space.
#[tauri::command]
pub fn set_space_label(
    display_id: String,
    space_index: usize,
    label: String,
) -> Result<(), String> {
    log::info!(
        "[cmd] set_space_label: display={}, index={}, label='{}'",
        display_id, space_index, label
    );
    storage::set_label(&display_id, space_index, &label)
}

/// Set the collapsed state for a space.
#[tauri::command]
pub fn set_space_collapsed(
    display_id: String,
    space_index: usize,
    collapsed: bool,
) -> Result<(), String> {
    storage::set_collapsed(&display_id, space_index, collapsed)
}

/// Navigate to a specific space by index.
#[tauri::command]
pub fn navigate_to_space(
    space_index: usize,
    current_space_id: i64,
    target_space_id: i64,
    window_title: Option<String>,
) -> Result<(), String> {
    log::info!(
        "[cmd] navigate_to_space: index={}, current={}, target={}, window={:?}",
        space_index, current_space_id, target_space_id, window_title
    );
    navigator::navigate_to_space(
        space_index,
        current_space_id,
        target_space_id,
        window_title.as_deref(),
    )
}

/// Navigate to a specific window.
#[tauri::command]
pub fn navigate_to_window(app_name: String, window_title: String) -> Result<(), String> {
    log::info!(
        "[cmd] navigate_to_window: app='{}', window='{}'",
        app_name, window_title
    );
    navigator::navigate_to_window(&app_name, &window_title)
}

/// Close a specific window.
#[tauri::command]
pub fn close_window(app_name: String, window_title: String) -> Result<(), String> {
    log::info!(
        "[cmd] close_window: app='{}', window='{}'",
        app_name, window_title
    );
    navigator::close_window(&app_name, &window_title)
}

/// Close (remove) a macOS space via Mission Control automation.
/// This is experimental and may not work on all macOS versions.
#[tauri::command]
pub fn close_space(space_index: usize) -> Result<(), String> {
    log::info!("[cmd] close_space: index={}", space_index);
    navigator::close_space(space_index)
}

/// Update user settings.
#[tauri::command]
pub fn update_settings(settings: storage::UserSettings) -> Result<(), String> {
    log::info!(
        "[cmd] update_settings: low_opacity_when_idle={}, suppress_dock={}, highlight_running_apps={}, idle_opacity={}, orientation={}",
        settings.low_opacity_when_idle,
        settings.suppress_dock,
        settings.highlight_running_apps,
        settings.idle_opacity,
        settings.orientation,
    );
    storage::update_settings(settings)
}

/// Get stored user settings.
#[tauri::command]
pub fn get_settings() -> storage::UserSettings {
    let data = storage::load();
    log::info!(
        "[cmd] get_settings: low_opacity_when_idle={}, suppress_dock={}, highlight_running_apps={}, idle_opacity={}, orientation={}",
        data.settings.low_opacity_when_idle,
        data.settings.suppress_dock,
        data.settings.highlight_running_apps,
        data.settings.idle_opacity,
        data.settings.orientation,
    );
    data.settings
}

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

// ---------------------------------------------------------------------------
// App group commands
// ---------------------------------------------------------------------------

/// Get all app groups.
#[tauri::command]
pub fn get_app_groups() -> Vec<storage::AppGroup> {
    storage::get_app_groups()
}

/// Create a new app group. Returns the created group.
#[tauri::command]
pub fn create_app_group(name: String) -> Result<storage::AppGroup, String> {
    log::info!("[cmd] create_app_group: name='{}'", name);
    storage::create_app_group(&name)
}

/// Update an existing app group (name, apps, collapsed).
#[tauri::command]
pub fn update_app_group(group: storage::AppGroup) -> Result<(), String> {
    log::info!("[cmd] update_app_group: id='{}', name='{}'", group.id, group.name);
    storage::update_app_group(group)
}

/// Batch-update the collapsed state for all app groups in a single disk write.
#[tauri::command]
pub fn batch_update_group_collapsed(collapsed_map: std::collections::HashMap<String, bool>) -> Result<(), String> {
    log::info!("[cmd] batch_update_group_collapsed: {} entries", collapsed_map.len());
    storage::batch_update_collapsed(&collapsed_map)
}

/// Delete an app group by ID.
#[tauri::command]
pub fn delete_app_group(id: String) -> Result<(), String> {
    log::info!("[cmd] delete_app_group: id='{}'", id);
    storage::delete_app_group(&id)
}

/// Add an entry (app, path, or URL) to a group.
#[tauri::command]
pub fn add_app_to_group(group_id: String, bundle_id: String, name: String, entry_type: Option<String>) -> Result<(), String> {
    let et = entry_type.as_deref().unwrap_or("app");
    log::info!(
        "[cmd] add_app_to_group: group='{}', bundle='{}', name='{}', type='{}'",
        group_id, bundle_id, name, et
    );
    storage::add_app_to_group(&group_id, &bundle_id, &name, et)
}

/// Remove an app from a group.
#[tauri::command]
pub fn remove_app_from_group(group_id: String, bundle_id: String) -> Result<(), String> {
    log::info!(
        "[cmd] remove_app_from_group: group='{}', bundle='{}'",
        group_id, bundle_id
    );
    storage::remove_app_from_group(&group_id, &bundle_id)
}

/// Reorder app groups.
#[tauri::command]
pub fn reorder_app_groups(ordered_ids: Vec<String>) -> Result<(), String> {
    log::info!("[cmd] reorder_app_groups: {:?}", ordered_ids);
    storage::reorder_app_groups(&ordered_ids)
}

/// Set app tray visibility.
#[tauri::command]
pub fn set_app_tray_visible(visible: bool) -> Result<(), String> {
    storage::set_app_tray_visible(visible)
}

/// Get app tray visibility.
#[tauri::command]
pub fn get_app_tray_visible() -> bool {
    storage::get_app_tray_visible()
}

// ---------------------------------------------------------------------------
// App discovery & launching commands
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
    use std::collections::HashMap;

    let t0 = std::time::Instant::now();
    log::info!("[cmd] get_all_discoverable_apps: starting");

    let dock = apps::get_dock_apps().unwrap_or_default();
    log::info!("[cmd] get_all_discoverable_apps: {} dock apps ({:.0?})", dock.len(), t0.elapsed());

    let running = apps::get_running_apps().unwrap_or_default();
    log::info!("[cmd] get_all_discoverable_apps: {} running apps ({:.0?})", running.len(), t0.elapsed());

    let installed = apps::get_installed_apps().unwrap_or_default();
    log::info!("[cmd] get_all_discoverable_apps: {} installed apps ({:.0?})", installed.len(), t0.elapsed());

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

/// Fetch icons for many bundle IDs in a single Swift process.
/// Returns a map of bundle_id → data:image/png;base64,… URIs.
#[cfg(target_os = "macos")]
fn batch_get_app_icons(
    bundle_ids: &[&str],
) -> Result<std::collections::HashMap<String, String>, String> {
    use std::collections::HashMap;
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
    let json: HashMap<String, String> = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse icon JSON: {e}"))?;

    // Convert raw base64 to data URIs.
    let result: HashMap<String, String> = json
        .into_iter()
        .map(|(k, v)| (k, format!("data:image/png;base64,{v}")))
        .collect();

    Ok(result)
}

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

/// Payload emitted to the frontend when "Remove from Group" is clicked
/// in the native context menu.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuRemovePayload {
    pub group_id: String,
    pub bundle_id: String,
}

/// Show a native context menu for a group entry (app, path, or URL).
///
/// Creates a real macOS popup menu that floats over everything (even outside
/// the window bounds). Menu items differ by entry type:
///   - app:  Launch, Quit, Dock Menu, Remove from Group.
///   - path: Open, Show in Finder, Remove from Group.
///   - url:  Open in Browser, Copy URL, Remove from Group.
#[tauri::command]
pub fn show_app_context_menu(
    window: tauri::Window,
    app_name: String,
    bundle_id: String,
    group_id: String,
    entry_type: Option<String>,
) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

    let et = entry_type.as_deref().unwrap_or("app");
    log::info!(
        "[cmd] show_app_context_menu: name='{}', id='{}', group='{}', type='{}'",
        app_name, bundle_id, group_id, et
    );

    let remove_id = format!("ctx-remove:{}:{}", group_id, bundle_id);
    let separator = PredefinedMenuItem::separator(&window).map_err(|e| e.to_string())?;
    let remove = MenuItem::with_id(&window, &remove_id, "Remove from Group", true, None::<&str>)
        .map_err(|e| e.to_string())?;

    let menu = match et {
        "path" => {
            let open_id = format!("ctx-openpath:{}", bundle_id);
            let finder_id = format!("ctx-finder:{}", bundle_id);
            let open = MenuItem::with_id(&window, &open_id, "Open", true, None::<&str>)
                .map_err(|e| e.to_string())?;
            let finder = MenuItem::with_id(&window, &finder_id, "Show in Finder", true, None::<&str>)
                .map_err(|e| e.to_string())?;
            Menu::with_items(&window, &[&open, &finder, &separator, &remove])
                .map_err(|e| e.to_string())?
        }
        "url" => {
            let open_id = format!("ctx-openurl:{}", bundle_id);
            let copy_id = format!("ctx-copyurl:{}", bundle_id);
            let open = MenuItem::with_id(&window, &open_id, "Open in Browser", true, None::<&str>)
                .map_err(|e| e.to_string())?;
            let copy = MenuItem::with_id(&window, &copy_id, "Copy URL", true, None::<&str>)
                .map_err(|e| e.to_string())?;
            Menu::with_items(&window, &[&open, &copy, &separator, &remove])
                .map_err(|e| e.to_string())?
        }
        _ => {
            // Default: app entry.
            let launch_id = format!("ctx-launch:{}", bundle_id);
            let quit_id = format!("ctx-quit:{}", bundle_id);
            let dock_id = format!("ctx-dock:{}", app_name);
            let launch = MenuItem::with_id(&window, &launch_id, "Launch", true, None::<&str>)
                .map_err(|e| e.to_string())?;
            let quit = MenuItem::with_id(&window, &quit_id, "Quit", true, None::<&str>)
                .map_err(|e| e.to_string())?;
            let dock_menu_item = MenuItem::with_id(&window, &dock_id, "Dock Menu", true, None::<&str>)
                .map_err(|e| e.to_string())?;
            Menu::with_items(&window, &[&launch, &quit, &dock_menu_item, &separator, &remove])
                .map_err(|e| e.to_string())?
        }
    };

    // Handle actions directly in the menu event callback so there's no
    // timing issue between popup_menu returning and the event firing.
    window.on_menu_event(move |win, event| {
        let id = event.id().0.as_str();
        log::info!("[ctx-menu] selected: {}", id);

        if let Some(bid) = id.strip_prefix("ctx-launch:") {
            let bid = bid.to_string();
            std::thread::spawn(move || {
                if let Err(e) = apps::launch_app(&bid) {
                    log::error!("[ctx-menu] Launch failed: {}", e);
                }
            });
        } else if let Some(bid) = id.strip_prefix("ctx-quit:") {
            let bid = bid.to_string();
            std::thread::spawn(move || {
                if let Err(e) = apps::quit_app(&bid) {
                    log::error!("[ctx-menu] Quit failed: {}", e);
                }
            });
        } else if let Some(name) = id.strip_prefix("ctx-dock:") {
            let name = name.to_string();
            std::thread::spawn(move || {
                if let Err(e) = apps::show_dock_menu(&name) {
                    log::error!("[ctx-menu] Dock menu failed: {}", e);
                }
            });
        } else if let Some(path) = id.strip_prefix("ctx-openpath:") {
            let path = path.to_string();
            std::thread::spawn(move || {
                if let Err(e) = apps::open_path(&path) {
                    log::error!("[ctx-menu] Open path failed: {}", e);
                }
            });
        } else if let Some(path) = id.strip_prefix("ctx-finder:") {
            let path = path.to_string();
            std::thread::spawn(move || {
                // Reveal in Finder using 'open -R'.
                let status = std::process::Command::new("open")
                    .args(["-R", &path])
                    .status();
                if let Err(e) = status {
                    log::error!("[ctx-menu] Show in Finder failed: {}", e);
                }
            });
        } else if let Some(url) = id.strip_prefix("ctx-openurl:") {
            let url = url.to_string();
            std::thread::spawn(move || {
                if let Err(e) = apps::open_url(&url) {
                    log::error!("[ctx-menu] Open URL failed: {}", e);
                }
            });
        } else if let Some(url) = id.strip_prefix("ctx-copyurl:") {
            // Copy URL to clipboard.
            let url = url.to_string();
            std::thread::spawn(move || {
                let status = std::process::Command::new("pbcopy")
                    .stdin(std::process::Stdio::piped())
                    .spawn()
                    .and_then(|mut child| {
                        use std::io::Write;
                        if let Some(ref mut stdin) = child.stdin {
                            stdin.write_all(url.as_bytes())?;
                        }
                        child.wait()
                    });
                if let Err(e) = status {
                    log::error!("[ctx-menu] Copy URL failed: {}", e);
                }
            });
        } else if let Some(rest) = id.strip_prefix("ctx-remove:") {
            // rest = "groupId:bundleId"
            if let Some((gid, bid)) = rest.split_once(':') {
                let payload = ContextMenuRemovePayload {
                    group_id: gid.to_string(),
                    bundle_id: bid.to_string(),
                };
                let _ = win.emit("ctx-menu-remove", &payload);
            }
        }
    });

    // popup_menu blocks until the user selects an item or dismisses the menu.
    window.popup_menu(&menu).map_err(|e| e.to_string())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Dock auto-hide management
// ---------------------------------------------------------------------------

/// Prevent (or allow) the macOS Dock from appearing.
///
/// When `suppress` is true, the Dock's autohide-delay is set to a huge value
/// (effectively preventing it from ever sliding in), and autohide is forced on.
/// When false, the delay is removed (restoring the system default) so the
/// Dock behaves normally again.
#[tauri::command]
pub fn set_dock_suppressed(suppress: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        log::info!("[cmd] set_dock_suppressed: suppress={}", suppress);

        if suppress {
            // Read and save the user's current autohide state before we change it.
            let current_autohide = read_dock_autohide();
            let mut data = storage::load();
            data.settings.original_dock_autohide = Some(current_autohide);
            let _ = storage::save(&data);
            log::info!(
                "[cmd] Saved original Dock autohide state: {}",
                current_autohide
            );

            // Force autohide on (in case the user hasn't already).
            let _ = std::process::Command::new("defaults")
                .args(["write", "com.apple.dock", "autohide", "-bool", "TRUE"])
                .status();

            // Set the delay to an absurdly high value so the Dock never triggers.
            let _ = std::process::Command::new("defaults")
                .args([
                    "write",
                    "com.apple.dock",
                    "autohide-delay",
                    "-float",
                    "1000000",
                ])
                .status();
        } else {
            // Remove the custom delay, restoring the system default (≈0.5 s).
            let _ = std::process::Command::new("defaults")
                .args(["delete", "com.apple.dock", "autohide-delay"])
                .status();

            // Restore the original autohide state.
            let data = storage::load();
            let original = data.settings.original_dock_autohide.unwrap_or(false);
            log::info!(
                "[cmd] Restoring original Dock autohide state: {}",
                original
            );
            let val = if original { "TRUE" } else { "FALSE" };
            let _ = std::process::Command::new("defaults")
                .args(["write", "com.apple.dock", "autohide", "-bool", val])
                .status();
        }

        // Restart the Dock to apply.
        let _ = std::process::Command::new("killall")
            .arg("Dock")
            .status();

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = suppress;
        Err("Dock management is only available on macOS.".to_string())
    }
}

/// Helper: read the current Dock autohide boolean.
fn read_dock_autohide() -> bool {
    let output = std::process::Command::new("defaults")
        .args(["read", "com.apple.dock", "autohide"])
        .output();
    match output {
        Ok(o) => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            s == "1" || s.eq_ignore_ascii_case("true")
        }
        Err(_) => false,
    }
}

/// Check whether the Dock is currently suppressed (autohide-delay ≥ 10 000).
#[tauri::command]
pub fn get_dock_suppressed() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("defaults")
            .args(["read", "com.apple.dock", "autohide-delay"])
            .output()
            .map_err(|e| format!("Failed to read Dock autohide-delay: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        // If the key doesn't exist, `defaults read` returns a non-zero exit
        // code and stdout is empty — treat that as "not suppressed".
        let delay: f64 = stdout.parse().unwrap_or(0.0);
        Ok(delay >= 10_000.0)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Dock management is only available on macOS.".to_string())
    }
}

// ---------------------------------------------------------------------------
// Background polling loop
// ---------------------------------------------------------------------------

/// Runs continuously in a background tokio task, polling space and window
/// data and emitting state update events to the frontend only when
/// something has actually changed.
pub async fn background_poll(app_handle: AppHandle) {
    let mut last_payload: Option<SpaceStatePayload> = None;

    loop {
        if let Some(payload) = build_state_payload() {
            // Only emit if the data has changed (ignoring timestamp).
            let changed = match &last_payload {
                Some(prev) => {
                    prev.active_space_id != payload.active_space_id
                        || prev.spaces != payload.spaces
                }
                None => true,
            };

            if changed {
                let _ = app_handle.emit("space-state-update", &payload);
                last_payload = Some(payload);
            }
        }

        // Poll every second for OS-level changes.
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Build the combined state payload from spaces + windows + stored labels.
///
/// Also prunes stale label/collapsed entries whose keys no longer match any
/// live space (e.g. after the user closes a space and macOS renumbers).
fn build_state_payload() -> Option<SpaceStatePayload> {
    let space_list = spaces::enumerate_spaces()?;
    let window_map = windows::enumerate_windows().unwrap_or_default();
    let mut stored = storage::load();

    let active_space_id = space_list
        .iter()
        .find(|s| s.is_active)
        .map(|s| s.space_id)
        .unwrap_or(0);

    // Collect the set of keys that correspond to currently live spaces.
    let live_keys: std::collections::HashSet<String> = space_list
        .iter()
        .map(|s| storage::space_key(&s.display_id, s.space_index))
        .collect();

    // Prune stored labels and collapsed entries that no longer match a live space.
    let stale_label_keys: Vec<String> = stored
        .labels
        .keys()
        .filter(|k| !live_keys.contains(*k))
        .cloned()
        .collect();
    let stale_collapsed_keys: Vec<String> = stored
        .collapsed
        .keys()
        .filter(|k| !live_keys.contains(*k))
        .cloned()
        .collect();

    if !stale_label_keys.is_empty() || !stale_collapsed_keys.is_empty() {
        for k in &stale_label_keys {
            log::info!("[state] Pruning stale label key: {}", k);
            stored.labels.remove(k);
        }
        for k in &stale_collapsed_keys {
            log::info!("[state] Pruning stale collapsed key: {}", k);
            stored.collapsed.remove(k);
        }
        let _ = storage::save(&stored);
    }

    let spaces_with_windows: Vec<SpaceWithWindows> = space_list
        .into_iter()
        .map(|s| {
            let key = storage::space_key(&s.display_id, s.space_index);
            let label = stored.labels.get(&key).cloned().unwrap_or_default();
            let is_collapsed = stored.collapsed.get(&key).copied().unwrap_or(false);
            let wins = window_map.get(&s.space_id).cloned().unwrap_or_default();

            SpaceWithWindows {
                space_id: s.space_id,
                space_index: s.space_index,
                display_id: s.display_id.clone(),
                label,
                is_active: s.is_active,
                is_visible: s.is_visible,
                is_collapsed,
                is_builtin_display: s.is_builtin_display,
                windows: wins,
            }
        })
        .collect();

    Some(SpaceStatePayload {
        spaces: spaces_with_windows,
        active_space_id,
        timestamp: chrono::Utc::now().timestamp_millis(),
    })
}
