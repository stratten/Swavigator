#![allow(dead_code)]
// The `objc` crate's msg_send!/class! macros internally check for
// cfg(feature = "cargo-clippy") which triggers unexpected_cfgs warnings.
// Suppressed here since the warnings originate in external macro expansions.
#![allow(unexpected_cfgs)]

#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

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
            // Set the macOS Dock icon programmatically. In dev mode the app
            // runs as a raw binary (no .app bundle), so macOS won't pick up
            // the .icns file. This embeds icon.png at compile time and sets
            // it via NSApplication so the correct icon appears in the Dock
            // regardless of how the app is launched.
            #[cfg(target_os = "macos")]
            #[allow(deprecated, unexpected_cfgs)]
            {
                use cocoa::appkit::NSImage;
                use cocoa::base::nil;
                use cocoa::foundation::NSData;

                static ICON_BYTES: &[u8] = include_bytes!("../icons/icon-dock.png");
                unsafe {
                    let data = NSData::dataWithBytes_length_(
                        nil,
                        ICON_BYTES.as_ptr() as *const std::os::raw::c_void,
                        ICON_BYTES.len() as u64,
                    );
                    let icon = NSImage::initWithData_(NSImage::alloc(nil), data);
                    // Explicitly set size so macOS renders at the correct
                    // resolution and respects the alpha channel.
                    let size = cocoa::foundation::NSSize::new(512.0, 512.0);
                    let _: () = objc::msg_send![icon, setSize: size];
                    let ns_app: *mut objc::runtime::Object =
                        objc::msg_send![objc::class!(NSApplication), sharedApplication];
                    let _: () = objc::msg_send![ns_app, setApplicationIconImage: icon];
                }
            }

            // ----- macOS permission checks -----
            // Prompt for Accessibility, trigger Automation, and check
            // Screen Recording — all required for full functionality.
            #[cfg(target_os = "macos")]
            {
                request_macos_permissions();
            }

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

/// Request the macOS permissions that Swavigator needs to function:
///   1. **Accessibility** — for window navigation and space management.
///   2. **Automation** — for controlling System Events (keyboard shortcuts).
///   3. **Screen Recording** — for reading window titles from other apps.
#[cfg(target_os = "macos")]
#[allow(deprecated, unexpected_cfgs)]
fn request_macos_permissions() {
    // 1. Accessibility — prompt the user if not already trusted.
    //    AXIsProcessTrustedWithOptions with kAXTrustedCheckOptionPrompt=true
    //    shows the system dialog on first launch.
    unsafe {
        extern "C" {
            fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
        }

        let key: *const objc::runtime::Object =
            objc::msg_send![objc::class!(NSString), stringWithUTF8String:
                b"AXTrustedCheckOptionPrompt\0".as_ptr()];
        let yes: *const objc::runtime::Object =
            objc::msg_send![objc::class!(NSNumber), numberWithBool: true];
        let options: *const objc::runtime::Object =
            objc::msg_send![objc::class!(NSDictionary),
                dictionaryWithObject: yes
                forKey: key];

        let trusted = AXIsProcessTrustedWithOptions(options as *const std::ffi::c_void);
        if trusted {
            log::info!("[permissions] Accessibility: granted.");
        } else {
            log::warn!("[permissions] Accessibility: NOT granted — prompting user.");
        }
    }

    // 2. Automation — trigger a harmless System Events query so macOS
    //    shows the Automation permission prompt on first run.
    std::thread::spawn(|| {
        let output = std::process::Command::new("osascript")
            .args(["-e", r#"tell application "System Events" to return name of first process"#])
            .output();
        match output {
            Ok(o) if o.status.success() => {
                log::info!("[permissions] Automation (System Events): granted.");
            }
            _ => {
                log::warn!("[permissions] Automation (System Events): NOT granted or prompt shown.");
            }
        }
    });

    // 3. Screen Recording — use CGRequestScreenCaptureAccess() directly
    //    from the main process so the permission prompt is associated with
    //    Swavigator.app (not a child swift process). This triggers the
    //    native macOS permission dialog and may require an app restart.
    unsafe {
        extern "C" {
            fn CGPreflightScreenCaptureAccess() -> bool;
            fn CGRequestScreenCaptureAccess() -> bool;
        }

        let already_granted = CGPreflightScreenCaptureAccess();
        if already_granted {
            log::info!("[permissions] Screen Recording: granted.");
        } else {
            log::warn!("[permissions] Screen Recording: NOT granted — requesting.");
            let granted = CGRequestScreenCaptureAccess();
            if granted {
                log::info!("[permissions] Screen Recording: granted after prompt.");
            } else {
                log::warn!(
                    "[permissions] Screen Recording: user must grant manually and restart."
                );
            }
        }
    }
}
