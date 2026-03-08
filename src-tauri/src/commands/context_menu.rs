//! Native context menu handling for app group entries.
//!
//! Creates real macOS popup menus that float over everything, with actions
//! that differ by entry type (app, path, or URL).

use serde::Serialize;
use tauri::Emitter;

use crate::apps;

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
        app_name,
        bundle_id,
        group_id,
        et
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
            let finder =
                MenuItem::with_id(&window, &finder_id, "Show in Finder", true, None::<&str>)
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
            let dock_menu_item =
                MenuItem::with_id(&window, &dock_id, "Dock Menu", true, None::<&str>)
                    .map_err(|e| e.to_string())?;
            Menu::with_items(
                &window,
                &[&launch, &quit, &dock_menu_item, &separator, &remove],
            )
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
