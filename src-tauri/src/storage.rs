use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// A single entry within an app group (application, folder/file, or URL).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    /// Unique identifier for this entry.
    /// - app:  macOS bundle identifier (e.g. "com.apple.mail").
    /// - path: absolute file path (e.g. "/Users/me/Downloads").
    /// - url:  full URL string (e.g. "https://example.com").
    pub bundle_id: String,
    /// Cached display name.
    pub name: String,
    /// Entry type discriminator: "app" (default), "path", or "url".
    #[serde(default = "default_entry_type")]
    pub entry_type: String,
}

fn default_entry_type() -> String {
    "app".to_string()
}

/// Infer the correct entry type from a bundle_id when the caller passes "app"
/// but the ID is clearly a file path or URL.
fn infer_entry_type(bundle_id: &str, declared: &str) -> String {
    if declared != "app" {
        return declared.to_string();
    }
    if bundle_id.starts_with('/') {
        return "path".to_string();
    }
    if bundle_id.starts_with("http://") || bundle_id.starts_with("https://") {
        return "url".to_string();
    }
    declared.to_string()
}

/// A user-defined group of applications (e.g. "Communications").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppGroup {
    /// Unique identifier (UUID v4).
    pub id: String,
    /// User-assigned group name.
    pub name: String,
    /// Ordered list of apps in this group.
    #[serde(default)]
    pub apps: Vec<AppEntry>,
    /// Whether this group is collapsed in the UI.
    #[serde(default)]
    pub collapsed: bool,
}

/// A single to-do item within a space's checklist.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    /// Unique identifier (UUID v4).
    pub id: String,
    /// To-do text.
    pub text: String,
    /// Whether this item has been completed.
    #[serde(default)]
    pub completed: bool,
}

/// On-disk format for persisted Swavigator data.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoredData {
    /// [LEGACY] Space labels keyed by "displayId:spaceIndex" (e.g. "ABC-123:3").
    /// Retained for backwards compatibility; new labels use `labels_by_space_id`.
    #[serde(default)]
    pub labels: HashMap<String, String>,

    /// Space labels keyed by spaceId (macOS ManagedSpaceID).
    /// This survives space reordering in Mission Control.
    #[serde(default)]
    pub labels_by_space_id: HashMap<i64, String>,

    /// [LEGACY] Collapsed state keyed by "displayId:spaceIndex".
    #[serde(default)]
    pub collapsed: HashMap<String, bool>,

    /// Collapsed state keyed by spaceId (macOS ManagedSpaceID).
    #[serde(default)]
    pub collapsed_by_space_id: HashMap<i64, bool>,

    /// User settings.
    #[serde(default)]
    pub settings: UserSettings,

    /// User-defined application groups for the app tray.
    #[serde(default)]
    pub app_groups: Vec<AppGroup>,

    /// Whether the app tray is visible.
    #[serde(default)]
    pub app_tray_visible: bool,

    /// Per-space to-do checklists keyed by spaceId.
    #[serde(default)]
    pub todos_by_space_id: HashMap<i64, Vec<TodoItem>>,
}

/// Persisted user preferences.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    /// Default view mode for all spaces.
    #[serde(default = "default_view_mode")]
    pub view_mode: String,

    /// Per-space view mode overrides keyed by "displayId:spaceIndex".
    #[serde(default)]
    pub space_view_modes: HashMap<String, String>,

    /// Font size (px) for space name labels.
    #[serde(default = "default_space_name_font_size")]
    pub space_name_font_size: u8,

    /// Font size (px) for window/app name text.
    #[serde(default = "default_window_font_size")]
    pub window_font_size: u8,

    /// Remembered expanded window width (logical pixels).
    #[serde(default = "default_expanded_width")]
    pub expanded_width: u32,

    /// Remembered expanded window height (logical pixels).
    #[serde(default = "default_expanded_height")]
    pub expanded_height: u32,

    /// Font family CSS value.
    #[serde(default = "default_font_family")]
    pub font_family: String,

    /// Remembered window X position (physical pixels). None on first launch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_x: Option<i32>,

    /// Remembered window Y position (physical pixels). None on first launch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_y: Option<i32>,

    /// Whether Swavigator should suppress the macOS Dock from appearing. Disabled by default.
    #[serde(default)]
    pub suppress_dock: bool,

    /// The user's original Dock autohide state before Swavigator changed it.
    /// Saved when suppress_dock is first enabled so we can restore it on disable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_dock_autohide: Option<bool>,

    /// Whether the App Picker should hide apps that are already in any group.
    /// Defaults to true so the picker acts as a "to-do" work list.
    #[serde(default = "default_true")]
    pub hide_grouped_apps: bool,

    /// Global hotkey to toggle Swavigator window visibility (e.g. "Option+S").
    #[serde(default = "default_toggle_hotkey")]
    pub toggle_hotkey: String,

    /// Whether the panel should become nearly transparent when not hovered.
    #[serde(default)]
    pub low_opacity_when_idle: bool,

    /// Opacity level (0.0–1.0) when idle mode is active. Default 0.15.
    #[serde(default = "default_idle_opacity")]
    pub idle_opacity: f64,

    /// Whether to show a running indicator on launcher apps that have open windows.
    #[serde(default = "default_true")]
    pub highlight_running_apps: bool,

    /// Panel orientation: "vertical" (default) or "horizontal".
    #[serde(default = "default_orientation")]
    pub orientation: String,

    /// Remembered expanded window width for horizontal mode (logical pixels).
    #[serde(default = "default_horizontal_width")]
    pub expanded_horizontal_width: u32,

    /// Remembered expanded window height for horizontal mode (logical pixels).
    #[serde(default = "default_horizontal_height")]
    pub expanded_horizontal_height: u32,

    /// Percentage of space allocated to the app tray (0–100). Default 30.
    /// In vertical mode this is the percentage of height; in horizontal mode
    /// this is the percentage of width.
    #[serde(default = "default_tray_split_percent")]
    pub tray_split_percent: f64,

    /// Whether dock mode (auto-show on hover) is enabled.
    #[serde(default)]
    pub dock_mode: bool,

    /// Size in pixels of the trigger strip when dock mode is collapsed.
    #[serde(default = "default_dock_trigger_size")]
    pub dock_trigger_size: u32,

    /// Opacity of the trigger strip (0.0–1.0). Nearly invisible by default.
    #[serde(default = "default_dock_trigger_opacity")]
    pub dock_trigger_opacity: f64,

    /// Delay in ms before the panel hides after the cursor leaves.
    #[serde(default = "default_dock_hide_delay")]
    pub dock_hide_delay: u32,

    /// Which screen edge the panel is docked to ("left", "right", "top", "bottom").
    #[serde(default = "default_dock_edge")]
    pub dock_edge: String,

    /// Whether the per-space Tasks feature is enabled. Default true.
    #[serde(default = "default_true")]
    pub enable_todos: bool,

    /// Whether file logging to ~/Desktop/Swavigator_Logs/ is enabled.
    #[serde(default)]
    pub enable_logging: bool,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            view_mode: default_view_mode(),
            space_view_modes: HashMap::new(),
            space_name_font_size: default_space_name_font_size(),
            window_font_size: default_window_font_size(),
            expanded_width: default_expanded_width(),
            expanded_height: default_expanded_height(),
            font_family: default_font_family(),
            window_x: None,
            window_y: None,
            suppress_dock: false,
            original_dock_autohide: None,
            hide_grouped_apps: true,
            toggle_hotkey: default_toggle_hotkey(),
            low_opacity_when_idle: false,
            idle_opacity: default_idle_opacity(),
            highlight_running_apps: true,
            orientation: default_orientation(),
            expanded_horizontal_width: default_horizontal_width(),
            expanded_horizontal_height: default_horizontal_height(),
            tray_split_percent: default_tray_split_percent(),
            dock_mode: false,
            dock_trigger_size: default_dock_trigger_size(),
            dock_trigger_opacity: default_dock_trigger_opacity(),
            dock_hide_delay: default_dock_hide_delay(),
            dock_edge: default_dock_edge(),
            enable_todos: true,
            enable_logging: false,
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_view_mode() -> String {
    "compact".to_string()
}

fn default_space_name_font_size() -> u8 {
    13
}

fn default_window_font_size() -> u8 {
    12
}

fn default_expanded_width() -> u32 {
    280
}

fn default_expanded_height() -> u32 {
    400
}

fn default_font_family() -> String {
    "\"Helvetica Neue\", Helvetica, Arial, sans-serif".to_string()
}

fn default_toggle_hotkey() -> String {
    "Option+S".to_string()
}

fn default_idle_opacity() -> f64 {
    0.15
}

fn default_orientation() -> String {
    "vertical".to_string()
}

fn default_horizontal_width() -> u32 {
    800
}

fn default_horizontal_height() -> u32 {
    220
}

fn default_tray_split_percent() -> f64 {
    30.0
}

fn default_dock_trigger_size() -> u32 {
    8
}

fn default_dock_trigger_opacity() -> f64 {
    0.02
}

fn default_dock_hide_delay() -> u32 {
    800
}

fn default_dock_edge() -> String {
    "left".to_string()
}

/// Build a canonical key for a space: "displayId:spaceIndex".
pub fn space_key(display_id: &str, space_index: usize) -> String {
    format!("{}:{}", display_id, space_index)
}

/// Path to the Swavigator data directory: ~/.swavigator/.
fn data_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|d| d.join(".swavigator"))
}

/// Path to the main data file: ~/.swavigator/data.json.
fn data_file_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join("data.json"))
}

/// Load stored data from disk, or return defaults if the file doesn't exist.
pub fn load() -> StoredData {
    let Some(path) = data_file_path() else {
        return StoredData::default();
    };

    if !path.exists() {
        return StoredData::default();
    }

    let mut stored: StoredData = match std::fs::read_to_string(&path) {
        Ok(contents) => {
            serde_json::from_str(&contents).unwrap_or_default()
        }
        Err(e) => {
            log::warn!("[storage] Failed to read {}: {}", path.display(), e);
            StoredData::default()
        }
    };

    // Auto-correct entry types that were stored before the entryType field
    // existed (they default to "app" but the bundleId reveals the real type).
    for group in &mut stored.app_groups {
        for entry in &mut group.apps {
            let corrected = infer_entry_type(&entry.bundle_id, &entry.entry_type);
            if corrected != entry.entry_type {
                log::info!(
                    "[storage] Auto-correcting entryType for '{}': '{}' → '{}'",
                    entry.bundle_id, entry.entry_type, corrected
                );
                entry.entry_type = corrected;
            }
        }
    }

    stored
}

/// Save stored data to disk. Creates the directory if it doesn't exist.
pub fn save(data: &StoredData) -> Result<(), String> {
    let dir = data_dir().ok_or("Could not determine home directory.")?;
    let path = data_file_path().ok_or("Could not determine data file path.")?;

    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create directory {}: {}", dir.display(), e))?;

    let json = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize data: {}", e))?;

    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;

    Ok(())
}

/// [LEGACY] Set a label for a space by displayId:spaceIndex. Saves immediately.
pub fn set_label(display_id: &str, space_index: usize, label: &str) -> Result<(), String> {
    let mut data = load();
    let key = space_key(display_id, space_index);

    if label.is_empty() {
        data.labels.remove(&key);
    } else {
        data.labels.insert(key, label.to_string());
    }

    save(&data)
}

/// Set a label for a space by spaceId. Saves immediately.
/// This is the preferred method as spaceId survives space reordering.
pub fn set_label_by_id(space_id: i64, label: &str) -> Result<(), String> {
    log::info!(
        "[storage] set_label_by_id called — space_id={}, label='{}'",
        space_id,
        label
    );
    let mut data = load();
    log::info!(
        "[storage] set_label_by_id — loaded data, labels_by_space_id has {} entries",
        data.labels_by_space_id.len()
    );

    if label.is_empty() {
        log::info!("[storage] set_label_by_id — removing label for space_id={}", space_id);
        data.labels_by_space_id.remove(&space_id);
    } else {
        log::info!(
            "[storage] set_label_by_id — inserting label '{}' for space_id={}",
            label,
            space_id
        );
        data.labels_by_space_id.insert(space_id, label.to_string());
    }

    log::info!(
        "[storage] set_label_by_id — saving data, labels_by_space_id now has {} entries",
        data.labels_by_space_id.len()
    );
    let result = save(&data);
    match &result {
        Ok(()) => log::info!("[storage] set_label_by_id — save succeeded"),
        Err(e) => log::error!("[storage] set_label_by_id — save failed: {}", e),
    }
    result
}

/// [LEGACY] Get the label for a space by displayId:spaceIndex.
pub fn get_label(display_id: &str, space_index: usize) -> String {
    let data = load();
    let key = space_key(display_id, space_index);
    data.labels.get(&key).cloned().unwrap_or_default()
}

/// Get the label for a space by spaceId, falling back to legacy lookup.
pub fn get_label_by_id(space_id: i64, display_id: &str, space_index: usize) -> String {
    let data = load();
    // First check the new spaceId-based storage.
    if let Some(label) = data.labels_by_space_id.get(&space_id) {
        return label.clone();
    }
    // Fall back to legacy displayId:spaceIndex lookup for migration.
    let key = space_key(display_id, space_index);
    data.labels.get(&key).cloned().unwrap_or_default()
}

/// [LEGACY] Set the collapsed state for a space by displayId:spaceIndex.
pub fn set_collapsed(display_id: &str, space_index: usize, collapsed: bool) -> Result<(), String> {
    let mut data = load();
    let key = space_key(display_id, space_index);
    data.collapsed.insert(key, collapsed);
    save(&data)
}

/// Set the collapsed state for a space by spaceId. Saves immediately.
pub fn set_collapsed_by_id(space_id: i64, collapsed: bool) -> Result<(), String> {
    let mut data = load();
    data.collapsed_by_space_id.insert(space_id, collapsed);
    save(&data)
}

/// Get the collapsed state for a space by spaceId, falling back to legacy lookup.
pub fn get_collapsed_by_id(space_id: i64, display_id: &str, space_index: usize) -> bool {
    let data = load();
    // First check the new spaceId-based storage.
    if let Some(&collapsed) = data.collapsed_by_space_id.get(&space_id) {
        return collapsed;
    }
    // Fall back to legacy displayId:spaceIndex lookup for migration.
    let key = space_key(display_id, space_index);
    data.collapsed.get(&key).copied().unwrap_or(false)
}

/// Update user settings. Saves immediately.
///
/// Fields that the frontend may omit (Option fields) are preserved from the
/// existing stored settings when the incoming value is None, so a partial
/// update from the frontend doesn't wipe out backend-managed or previously
/// persisted values.
pub fn update_settings(settings: UserSettings) -> Result<(), String> {
    let mut data = load();
    log::info!(
        "[storage] update_settings: BEFORE — low_opacity_when_idle={}, suppress_dock={}, highlight_running_apps={}",
        data.settings.low_opacity_when_idle,
        data.settings.suppress_dock,
        data.settings.highlight_running_apps,
    );
    log::info!(
        "[storage] update_settings: INCOMING — low_opacity_when_idle={}, suppress_dock={}, highlight_running_apps={}",
        settings.low_opacity_when_idle,
        settings.suppress_dock,
        settings.highlight_running_apps,
    );
    // Preserve backend-managed / optional fields the frontend may not send.
    let original_dock_autohide = data.settings.original_dock_autohide;
    let window_x = settings.window_x.or(data.settings.window_x);
    let window_y = settings.window_y.or(data.settings.window_y);
    let hide_grouped = settings.hide_grouped_apps;
    data.settings = settings;
    data.settings.original_dock_autohide = original_dock_autohide;
    data.settings.window_x = window_x;
    data.settings.window_y = window_y;
    data.settings.hide_grouped_apps = hide_grouped;
    log::info!(
        "[storage] update_settings: AFTER (to be saved) — low_opacity_when_idle={}, suppress_dock={}, highlight_running_apps={}",
        data.settings.low_opacity_when_idle,
        data.settings.suppress_dock,
        data.settings.highlight_running_apps,
    );
    save(&data)
}

// ---------------------------------------------------------------------------
// App group helpers
// ---------------------------------------------------------------------------

/// Get all app groups.
pub fn get_app_groups() -> Vec<AppGroup> {
    load().app_groups
}

/// Create a new app group with the given name. Returns the new group.
pub fn create_app_group(name: &str) -> Result<AppGroup, String> {
    let mut data = load();
    let group = AppGroup {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        apps: Vec::new(),
        collapsed: false,
    };
    data.app_groups.push(group.clone());
    save(&data)?;
    Ok(group)
}

/// Update an existing app group (name, apps, collapsed state).
pub fn update_app_group(group: AppGroup) -> Result<(), String> {
    let mut data = load();
    if let Some(existing) = data.app_groups.iter_mut().find(|g| g.id == group.id) {
        *existing = group;
        save(&data)
    } else {
        Err(format!("App group '{}' not found.", group.id))
    }
}

/// Delete an app group by ID.
pub fn delete_app_group(id: &str) -> Result<(), String> {
    let mut data = load();
    let before = data.app_groups.len();
    data.app_groups.retain(|g| g.id != id);
    if data.app_groups.len() == before {
        return Err(format!("App group '{}' not found.", id));
    }
    save(&data)
}

/// Add an entry to a group. Prevents duplicates within the same group.
pub fn add_app_to_group(group_id: &str, bundle_id: &str, name: &str, entry_type: &str) -> Result<(), String> {
    let mut data = load();
    let group = data
        .app_groups
        .iter_mut()
        .find(|g| g.id == group_id)
        .ok_or_else(|| format!("App group '{}' not found.", group_id))?;

    // Prevent duplicate entries.
    if group.apps.iter().any(|a| a.bundle_id == bundle_id) {
        return Ok(());
    }

    group.apps.push(AppEntry {
        bundle_id: bundle_id.to_string(),
        name: name.to_string(),
        entry_type: infer_entry_type(bundle_id, entry_type),
    });
    save(&data)
}

/// Remove an app from a group by bundle ID.
pub fn remove_app_from_group(group_id: &str, bundle_id: &str) -> Result<(), String> {
    let mut data = load();
    let group = data
        .app_groups
        .iter_mut()
        .find(|g| g.id == group_id)
        .ok_or_else(|| format!("App group '{}' not found.", group_id))?;

    group.apps.retain(|a| a.bundle_id != bundle_id);
    save(&data)
}

/// Reorder app groups according to the given list of IDs.
pub fn reorder_app_groups(ordered_ids: &[String]) -> Result<(), String> {
    let mut data = load();
    let mut reordered = Vec::with_capacity(ordered_ids.len());
    for id in ordered_ids {
        let group = data
            .app_groups
            .iter()
            .find(|g| &g.id == id)
            .cloned()
            .ok_or_else(|| format!("App group '{}' not found.", id))?;
        reordered.push(group);
    }
    data.app_groups = reordered;
    save(&data)
}

/// Batch-update the collapsed state for all app groups in a single disk write.
/// Expects a map of group ID → collapsed bool.
pub fn batch_update_collapsed(collapsed_map: &std::collections::HashMap<String, bool>) -> Result<(), String> {
    let mut data = load();
    for group in data.app_groups.iter_mut() {
        if let Some(&collapsed) = collapsed_map.get(&group.id) {
            group.collapsed = collapsed;
        }
    }
    save(&data)
}

/// Get the app tray visibility state.
pub fn get_app_tray_visible() -> bool {
    load().app_tray_visible
}

/// Set the app tray visibility state.
pub fn set_app_tray_visible(visible: bool) -> Result<(), String> {
    let mut data = load();
    data.app_tray_visible = visible;
    save(&data)
}

// ---------------------------------------------------------------------------
// Space to-do helpers
// ---------------------------------------------------------------------------

/// Get all to-do items for a specific space.
pub fn get_todos_by_space_id(space_id: i64) -> Vec<TodoItem> {
    load()
        .todos_by_space_id
        .get(&space_id)
        .cloned()
        .unwrap_or_default()
}

/// Get all to-dos across all spaces, keyed by spaceId.
pub fn get_all_todos() -> HashMap<i64, Vec<TodoItem>> {
    load().todos_by_space_id
}

/// Add a new to-do item to a space. Returns the created item.
pub fn add_todo(space_id: i64, text: &str) -> Result<TodoItem, String> {
    let mut data = load();
    let item = TodoItem {
        id: uuid::Uuid::new_v4().to_string(),
        text: text.to_string(),
        completed: false,
    };
    data.todos_by_space_id
        .entry(space_id)
        .or_default()
        .push(item.clone());
    save(&data)?;
    Ok(item)
}

/// Toggle the completed state of a to-do item.
pub fn toggle_todo(space_id: i64, todo_id: &str) -> Result<(), String> {
    let mut data = load();
    let todos = data
        .todos_by_space_id
        .get_mut(&space_id)
        .ok_or_else(|| format!("No to-dos for space {}.", space_id))?;
    let item = todos
        .iter_mut()
        .find(|t| t.id == todo_id)
        .ok_or_else(|| format!("To-do '{}' not found.", todo_id))?;
    item.completed = !item.completed;
    save(&data)
}

/// Delete a to-do item from a space.
pub fn delete_todo(space_id: i64, todo_id: &str) -> Result<(), String> {
    let mut data = load();
    let todos = data
        .todos_by_space_id
        .get_mut(&space_id)
        .ok_or_else(|| format!("No to-dos for space {}.", space_id))?;
    let before = todos.len();
    todos.retain(|t| t.id != todo_id);
    if todos.len() == before {
        return Err(format!("To-do '{}' not found.", todo_id));
    }
    if todos.is_empty() {
        data.todos_by_space_id.remove(&space_id);
    }
    save(&data)
}

/// Update the text of an existing to-do item.
pub fn update_todo_text(space_id: i64, todo_id: &str, text: &str) -> Result<(), String> {
    let mut data = load();
    let todos = data
        .todos_by_space_id
        .get_mut(&space_id)
        .ok_or_else(|| format!("No to-dos for space {}.", space_id))?;
    let item = todos
        .iter_mut()
        .find(|t| t.id == todo_id)
        .ok_or_else(|| format!("To-do '{}' not found.", todo_id))?;
    item.text = text.to_string();
    save(&data)
}

/// Move a to-do item from one space (or unassigned, id=0) to another.
pub fn move_todo(from_space_id: i64, to_space_id: i64, todo_id: &str) -> Result<(), String> {
    let mut data = load();
    let from_todos = data
        .todos_by_space_id
        .get_mut(&from_space_id)
        .ok_or_else(|| format!("No to-dos for space {}.", from_space_id))?;
    let idx = from_todos
        .iter()
        .position(|t| t.id == todo_id)
        .ok_or_else(|| format!("To-do '{}' not found in space {}.", todo_id, from_space_id))?;
    let item = from_todos.remove(idx);
    data.todos_by_space_id
        .entry(to_space_id)
        .or_default()
        .push(item);
    save(&data)
}
