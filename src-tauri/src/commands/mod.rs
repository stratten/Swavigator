//! Core Tauri commands for space/window management, settings, and app groups.
//!
//! Additional commands are organized in separate submodules:
//! - `app_discovery`: Icon fetching, app discovery, launching
//! - `context_menu`: Native context menu handling
//! - `dock`: Dock auto-hide management

pub mod app_discovery;
pub mod context_menu;
pub mod dock;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{navigator, spaces, storage, windows};

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
    /// Windows that are currently minimized (not on any space).
    pub minimized_windows: Vec<windows::WindowInfo>,
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
// Space and window commands
// ---------------------------------------------------------------------------

/// Get the current space and window state (one-shot, for initial load).
#[tauri::command]
pub fn get_space_state() -> Result<SpaceStatePayload, String> {
    build_state_payload().ok_or_else(|| "Failed to enumerate spaces.".to_string())
}

/// Set a label for a space. Uses spaceId for storage (survives reordering).
#[tauri::command]
pub fn set_space_label(
    space_id: i64,
    label: String,
) -> Result<(), String> {
    log::info!(
        "[cmd] set_space_label: space_id={}, label='{}'",
        space_id,
        label
    );
    storage::set_label_by_id(space_id, &label)
}

/// Set the collapsed state for a space. Uses spaceId for storage (survives reordering).
#[tauri::command]
pub fn set_space_collapsed(
    space_id: i64,
    collapsed: bool,
) -> Result<(), String> {
    storage::set_collapsed_by_id(space_id, collapsed)
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
        space_index,
        current_space_id,
        target_space_id,
        window_title
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
        app_name,
        window_title
    );
    navigator::navigate_to_window(&app_name, &window_title)
}

/// Close a specific window.
#[tauri::command]
pub fn close_window(app_name: String, window_title: String) -> Result<(), String> {
    log::info!(
        "[cmd] close_window: app='{}', window='{}'",
        app_name,
        window_title
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

// ---------------------------------------------------------------------------
// Settings commands
// ---------------------------------------------------------------------------

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
    log::info!(
        "[cmd] update_app_group: id='{}', name='{}'",
        group.id,
        group.name
    );
    storage::update_app_group(group)
}

/// Batch-update the collapsed state for all app groups in a single disk write.
#[tauri::command]
pub fn batch_update_group_collapsed(
    collapsed_map: std::collections::HashMap<String, bool>,
) -> Result<(), String> {
    log::info!(
        "[cmd] batch_update_group_collapsed: {} entries",
        collapsed_map.len()
    );
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
pub fn add_app_to_group(
    group_id: String,
    bundle_id: String,
    name: String,
    entry_type: Option<String>,
) -> Result<(), String> {
    let et = entry_type.as_deref().unwrap_or("app");
    log::info!(
        "[cmd] add_app_to_group: group='{}', bundle='{}', name='{}', type='{}'",
        group_id,
        bundle_id,
        name,
        et
    );
    storage::add_app_to_group(&group_id, &bundle_id, &name, et)
}

/// Remove an app from a group.
#[tauri::command]
pub fn remove_app_from_group(group_id: String, bundle_id: String) -> Result<(), String> {
    log::info!(
        "[cmd] remove_app_from_group: group='{}', bundle='{}'",
        group_id,
        bundle_id
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
                        || prev.minimized_windows != payload.minimized_windows
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

    // Collect live keys for both legacy (displayId:spaceIndex) and new (spaceId) formats.
    let live_legacy_keys: std::collections::HashSet<String> = space_list
        .iter()
        .map(|s| storage::space_key(&s.display_id, s.space_index))
        .collect();
    let live_space_ids: std::collections::HashSet<i64> = space_list
        .iter()
        .map(|s| s.space_id)
        .collect();

    // Prune stale entries from both legacy and new storage.
    let stale_label_keys: Vec<String> = stored
        .labels
        .keys()
        .filter(|k| !live_legacy_keys.contains(*k))
        .cloned()
        .collect();
    let stale_collapsed_keys: Vec<String> = stored
        .collapsed
        .keys()
        .filter(|k| !live_legacy_keys.contains(*k))
        .cloned()
        .collect();
    let stale_label_ids: Vec<i64> = stored
        .labels_by_space_id
        .keys()
        .filter(|k| !live_space_ids.contains(*k))
        .copied()
        .collect();
    let stale_collapsed_ids: Vec<i64> = stored
        .collapsed_by_space_id
        .keys()
        .filter(|k| !live_space_ids.contains(*k))
        .copied()
        .collect();

    let has_stale = !stale_label_keys.is_empty()
        || !stale_collapsed_keys.is_empty()
        || !stale_label_ids.is_empty()
        || !stale_collapsed_ids.is_empty();

    if has_stale {
        for k in &stale_label_keys {
            log::info!("[state] Pruning stale label key: {}", k);
            stored.labels.remove(k);
        }
        for k in &stale_collapsed_keys {
            log::info!("[state] Pruning stale collapsed key: {}", k);
            stored.collapsed.remove(k);
        }
        for id in &stale_label_ids {
            log::info!("[state] Pruning stale label spaceId: {}", id);
            stored.labels_by_space_id.remove(id);
        }
        for id in &stale_collapsed_ids {
            log::info!("[state] Pruning stale collapsed spaceId: {}", id);
            stored.collapsed_by_space_id.remove(id);
        }
        let _ = storage::save(&stored);
    }

    // Migrate legacy labels/collapsed to spaceId-based storage.
    // For each live space, if it has a legacy entry but no spaceId entry, migrate it.
    let mut migrated = false;
    for s in &space_list {
        let legacy_key = storage::space_key(&s.display_id, s.space_index);

        // Migrate label if needed.
        if !stored.labels_by_space_id.contains_key(&s.space_id) {
            if let Some(legacy_label) = stored.labels.get(&legacy_key).cloned() {
                log::info!(
                    "[state] Migrating label for space {} (id={}): '{}' from legacy key '{}'",
                    s.space_index,
                    s.space_id,
                    legacy_label,
                    legacy_key
                );
                stored.labels_by_space_id.insert(s.space_id, legacy_label);
                stored.labels.remove(&legacy_key);
                migrated = true;
            }
        }

        // Migrate collapsed state if needed.
        if !stored.collapsed_by_space_id.contains_key(&s.space_id) {
            if let Some(legacy_collapsed) = stored.collapsed.get(&legacy_key).copied() {
                log::info!(
                    "[state] Migrating collapsed for space {} (id={}): {} from legacy key '{}'",
                    s.space_index,
                    s.space_id,
                    legacy_collapsed,
                    legacy_key
                );
                stored.collapsed_by_space_id.insert(s.space_id, legacy_collapsed);
                stored.collapsed.remove(&legacy_key);
                migrated = true;
            }
        }
    }

    if migrated {
        log::info!("[state] Saving migrated labels/collapsed to disk");
        let _ = storage::save(&stored);
    }

    let spaces_with_windows: Vec<SpaceWithWindows> = space_list
        .into_iter()
        .map(|s| {
            // Use spaceId-based lookup (legacy entries should now be migrated).
            let label = stored
                .labels_by_space_id
                .get(&s.space_id)
                .cloned()
                .unwrap_or_default();

            let is_collapsed = stored
                .collapsed_by_space_id
                .get(&s.space_id)
                .copied()
                .unwrap_or(false);
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

    // Extract minimized windows (spaceId == 0, not on any real space).
    let minimized_windows = window_map.get(&0).cloned().unwrap_or_default();

    Some(SpaceStatePayload {
        spaces: spaces_with_windows,
        active_space_id,
        minimized_windows,
        timestamp: chrono::Utc::now().timestamp_millis(),
    })
}
