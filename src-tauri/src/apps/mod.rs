//! App-related functionality: discovery, lifecycle, dock menus, and opening paths/URLs.

mod discovery;
mod dock;
mod lifecycle;
mod open;

use serde::Serialize;

// Re-export all public functions.
pub use discovery::{get_dock_apps, get_installed_apps, get_running_apps};
pub use dock::{get_app_badge_counts, show_dock_menu};
pub use lifecycle::{launch_app, quit_app};
pub use open::{get_path_icon, open_path, open_url};

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/// Minimal info about a discoverable application.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverableApp {
    pub bundle_id: String,
    pub name: String,
}

/// Badge count result for a single app.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBadge {
    pub bundle_id: String,
    /// Badge text (could be a number or text like "•"). Empty if no badge.
    pub badge: String,
}
