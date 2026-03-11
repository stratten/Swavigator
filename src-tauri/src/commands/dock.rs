//! Dock auto-hide management.
//!
//! Provides commands to suppress the macOS Dock (preventing it from appearing)
//! and restore it to normal behavior.

use crate::storage;

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
        let _ = std::process::Command::new("killall").arg("Dock").status();

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

/// Returns the macOS menu bar height in logical points so the frontend can
/// avoid positioning windows behind it.
#[tauri::command]
pub fn get_menu_bar_height() -> f64 {
    #[cfg(target_os = "macos")]
    {
        #[allow(deprecated, unexpected_cfgs)]
        unsafe {
            let screen: *mut objc::runtime::Object =
                objc::msg_send![objc::class!(NSScreen), mainScreen];
            if screen.is_null() {
                return 25.0;
            }
            let frame: cocoa::foundation::NSRect = objc::msg_send![screen, frame];
            let visible: cocoa::foundation::NSRect = objc::msg_send![screen, visibleFrame];
            // Cocoa uses bottom-left origin: menu bar height is the gap at the top.
            let h = frame.size.height - (visible.origin.y + visible.size.height);
            if h > 0.0 { h } else { 25.0 }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        0.0
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
