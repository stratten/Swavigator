#![allow(dead_code)]

mod apps;
mod commands;
mod navigator;
mod spaces;
mod storage;
mod windows;

use tauri::WebviewWindowBuilder;

pub fn run() {
    // Default to info-level logging so diagnostic messages appear in the
    // terminal. The RUST_LOG env var can still override this at runtime.
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info"),
    )
    .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_space_state,
            commands::get_cursor_position,
            commands::log_from_frontend,
            commands::set_space_label,
            commands::set_space_collapsed,
            commands::navigate_to_space,
            commands::navigate_to_window,
            commands::close_window,
            commands::close_space,
            commands::update_settings,
            commands::get_settings,
            commands::get_app_icon,
            // App groups
            commands::get_app_groups,
            commands::create_app_group,
            commands::update_app_group,
            commands::batch_update_group_collapsed,
            commands::delete_app_group,
            commands::add_app_to_group,
            commands::remove_app_from_group,
            commands::reorder_app_groups,
            commands::set_app_tray_visible,
            commands::get_app_tray_visible,
            // App discovery & launching
            commands::get_dock_apps,
            commands::get_installed_apps,
            commands::get_running_apps,
            commands::get_all_discoverable_apps,
            commands::launch_app,
            commands::open_path,
            commands::open_url,
            commands::get_path_icon,
            commands::get_app_badge_counts,
            commands::show_dock_menu,
            commands::show_app_context_menu,
            commands::set_dock_suppressed,
            commands::get_dock_suppressed,
        ])
        .setup(|app| {
            // Create the main window programmatically so we can call
            // disable_drag_drop_handler(). Without this, Tauri's default
            // drag-drop handler intercepts all native drag events (returning
            // true unconditionally), which prevents WKWebView from dispatching
            // JavaScript dragover / drop events — breaking HTML5 DnD entirely.
            let win = WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App(Default::default()),
            )
            .title("Swavigator")
            .inner_size(280.0, 400.0)
            .min_inner_size(80.0, 200.0)
            .resizable(true)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .position(100.0, 100.0)
            .disable_drag_drop_handler()
            .build()?;

            let _ = win.set_visible_on_all_workspaces(true);

            let app_handle = app.handle().clone();

            // Spawn the background polling loop.
            tauri::async_runtime::spawn(async move {
                commands::background_poll(app_handle).await;
            });

            Ok(())
        })
        .on_window_event(|_window, event| {
            // When the window is destroyed (app closing), restore the Dock
            // if suppress was enabled so the user isn't left without it.
            if let tauri::WindowEvent::Destroyed = event {
                let data = storage::load();
                if data.settings.suppress_dock {
                    log::info!("[lib] App closing — restoring Dock visibility.");

                    // Remove the suppression delay.
                    let _ = std::process::Command::new("defaults")
                        .args(["delete", "com.apple.dock", "autohide-delay"])
                        .status();

                    // Restore original autohide state (default to false if unknown).
                    let original = data.settings.original_dock_autohide.unwrap_or(false);
                    let val = if original { "TRUE" } else { "FALSE" };
                    let _ = std::process::Command::new("defaults")
                        .args(["write", "com.apple.dock", "autohide", "-bool", val])
                        .status();

                    let _ = std::process::Command::new("killall")
                        .arg("Dock")
                        .status();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
