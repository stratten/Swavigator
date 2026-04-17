//! Space and window navigation.

use crate::spaces::SpaceInfo;
#[cfg(target_os = "macos")]
use super::cgs;
#[cfg(target_os = "macos")]
use std::thread;
#[cfg(target_os = "macos")]
use std::time::Duration;

/// Navigate to a specific space by index (1-based).
///
/// Strategy:
///   1. Attempt hotkey-based routing first (direct jump, anchor+jump, or
///      per-display arrow stepping, depending on available routes).
///   2. Verify arrival on the target space via CGS active-space check.
///   3. On failure/no hotkey route, fall back to window-based navigation.
///   4. Return error only if all strategies fail.
pub fn navigate_to_space(
    space_index: usize,
    current_space_id: i64,
    target_space_id: i64,
    window_title_in_target: Option<&str>,
    spaces: &[SpaceInfo],
) -> Result<(), String> {
    if current_space_id == target_space_id {
        return Ok(()); // Already on this space.
    }

    #[cfg(target_os = "macos")]
    {
        match navigate_via_hotkey_route(spaces, current_space_id, target_space_id, space_index) {
            Ok(()) if is_on_target_space(target_space_id) => {
                return Ok(());
            }
            Ok(()) => {
                log::warn!(
                    "[nav] Hotkey route completed but active space is not target {}.",
                    target_space_id
                );
            }
            Err(err) => {
                log::warn!(
                    "[nav] Hotkey route failed for target {} (index {}): {}",
                    target_space_id,
                    space_index,
                    err
                );
            }
        }

        if let Some(title) = window_title_in_target {
            log::info!(
                "[nav] Falling back to window-based navigation for space {} via '{}'.",
                space_index,
                title
            );
            let _ = navigate_via_window(title);
            if is_on_target_space(target_space_id) {
                return Ok(());
            }
        }

        Err(format!(
            "Navigation failed for space {} (id {}).",
            space_index, target_space_id
        ))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (space_index, window_title_in_target, spaces);
        Err("Navigation is only supported on macOS.".to_string())
    }
}

/// Navigate to a specific window by title.
///
/// Uses the Application Exposé approach from CursorTracker:
/// 1. Find the window via CGWindowListCopyWindowInfo.
/// 2. Check if it's on a different space.
/// 3. If different space: trigger Application Exposé, find thumbnail, AXPress.
/// 4. If same space: AXRaise directly.
pub fn navigate_to_window(
    app_name: &str,
    window_title: &str,
    target_space_id: Option<i64>,
    spaces: &[SpaceInfo],
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        navigate_to_window_macos(app_name, window_title, target_space_id, spaces)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app_name, window_title, target_space_id, spaces);
        Err("Window navigation is only supported on macOS.".to_string())
    }
}

// ---------------------------------------------------------------------------
// macOS implementations
// ---------------------------------------------------------------------------

/// Navigate to a window using Application Exposé + AX (CursorTracker pattern).
///
/// This is a generalised version: rather than hard-coding "Cursor", we
/// search ALL windows across ALL apps for a matching title.
#[cfg(target_os = "macos")]
fn navigate_via_window(window_title: &str) -> Result<(), String> {
    let safe_title = window_title.replace('\\', "\\\\").replace('"', "\\\"");

    let swift_src = format!(
        r#"
import Cocoa
import CoreGraphics

@_silgen_name("CGSMainConnectionID")
func CGSMainConnectionID() -> Int32

@_silgen_name("CGSCopySpacesForWindows")
func CGSCopySpacesForWindows(_ cid: Int32, _ mask: Int32, _ wids: CFArray) -> CFArray?

@_silgen_name("CGSGetActiveSpace")
func CGSGetActiveSpace(_ cid: Int32) -> Int

func findAndPress(_ element: AXUIElement, target: String, depth: Int = 0) -> Bool {{
    if depth > 12 {{ return false }}
    var titleRef: CFTypeRef?
    if AXUIElementCopyAttributeValue(
        element, kAXTitleAttribute as CFString, &titleRef
    ) == .success, let title = titleRef as? String, !title.isEmpty {{
        if title.contains(target) {{
            let r = AXUIElementPerformAction(element, kAXPressAction as CFString)
            if r == .success {{ return true }}
            let r2 = AXUIElementPerformAction(element, kAXRaiseAction as CFString)
            return r2 == .success
        }}
    }}
    var childrenRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
        element, kAXChildrenAttribute as CFString, &childrenRef
    ) == .success, let children = childrenRef as? [AXUIElement] else {{
        return false
    }}
    for child in children {{
        if findAndPress(child, target: target, depth: depth + 1) {{
            return true
        }}
    }}
    return false
}}

let targetName = "{safe_title}"

// Find the window and its owning app.
let opts: CGWindowListOption = [.optionAll]
guard let windowList = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {{
    exit(1)
}}

var targetWID: CGWindowID? = nil
var targetPID: Int32? = nil
var targetAppName: String? = nil

for w in windowList {{
    guard let pid = w[kCGWindowOwnerPID as String] as? Int32,
          let wid = w[kCGWindowNumber as String] as? CGWindowID,
          let name = w[kCGWindowName as String] as? String,
          !name.isEmpty else {{ continue }}
    if name.contains(targetName) {{
        targetWID = wid
        targetPID = pid
        targetAppName = w[kCGWindowOwnerName as String] as? String
        break
    }}
}}

guard let wid = targetWID, let pid = targetPID else {{
    fputs("ERR: No window matched.\n", stderr)
    exit(1)
}}

let cid = CGSMainConnectionID()
let currentSpace = CGSGetActiveSpace(cid)
var targetSpace = currentSpace

if let spaces = CGSCopySpacesForWindows(cid, 0x7, [wid] as CFArray) as? [Int],
   !spaces.isEmpty {{
    targetSpace = spaces[0]
}}

if targetSpace != currentSpace {{
    // Activate the app first, then trigger Application Exposé.
    if let app = NSWorkspace.shared.runningApplications.first(where: {{ $0.processIdentifier == pid }}) {{
        app.activate()
    }}
    Thread.sleep(forTimeInterval: 0.3)

    let exposeScript = NSAppleScript(source: """
        tell application "System Events"
            key code 125 using control down
        end tell
    """)
    exposeScript?.executeAndReturnError(nil)
    Thread.sleep(forTimeInterval: 0.8)

    guard let dockApp = NSWorkspace.shared.runningApplications
            .first(where: {{ $0.bundleIdentifier == "com.apple.dock" }}) else {{
        exit(1)
    }}
    let dockRef = AXUIElementCreateApplication(dockApp.processIdentifier)

    if findAndPress(dockRef, target: targetName) {{
        Thread.sleep(forTimeInterval: 0.5)
        exit(0)
    }}

    // Dismiss Exposé on failure.
    let dismissScript = NSAppleScript(source: """
        tell application "System Events"
            key code 53
        end tell
    """)
    dismissScript?.executeAndReturnError(nil)
    Thread.sleep(forTimeInterval: 0.3)
}}

// Same space, minimized, or Exposé fallback: unminimize + AXRaise.
if let app = NSWorkspace.shared.runningApplications.first(where: {{ $0.processIdentifier == pid }}) {{
    app.activate()
}}
Thread.sleep(forTimeInterval: 0.15)

let appRef = AXUIElementCreateApplication(pid)
var windowsRef: CFTypeRef?
if AXUIElementCopyAttributeValue(
    appRef, kAXWindowsAttribute as CFString, &windowsRef
) == .success, let axWindows = windowsRef as? [AXUIElement] {{
    for axWin in axWindows {{
        var tRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            axWin, kAXTitleAttribute as CFString, &tRef
        ) == .success, let title = tRef as? String else {{ continue }}
        if title.contains(targetName) {{
            // If the window is minimized, unminimize it first.
            var minRef: CFTypeRef?
            if AXUIElementCopyAttributeValue(
                axWin, kAXMinimizedAttribute as CFString, &minRef
            ) == .success, let isMin = minRef as? Bool, isMin {{
                AXUIElementSetAttributeValue(
                    axWin, kAXMinimizedAttribute as CFString, false as CFBoolean
                )
                Thread.sleep(forTimeInterval: 0.3)
            }}
            AXUIElementPerformAction(axWin, kAXRaiseAction as CFString)
            Thread.sleep(forTimeInterval: 0.1)
            AXUIElementPerformAction(axWin, kAXRaiseAction as CFString)
            exit(0)
        }}
    }}
}}
exit(0)
"#
    );

    let output = std::process::Command::new("swift")
        .arg("-e")
        .arg(&swift_src)
        .output()
        .map_err(|e| format!("Failed to execute Swift: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("[nav] Window navigation script failed: {}", stderr);
        return Err(format!("Navigation failed: {}", stderr));
    }

    Ok(())
}

#[cfg(target_os = "macos")]
#[allow(non_upper_case_globals)]
const kCGHIDEventTap: u32 = 0;
#[cfg(target_os = "macos")]
#[allow(non_upper_case_globals)]
const kCGEventFlagMaskControl: u64 = 1 << 18;
#[cfg(target_os = "macos")]
const KEY_LEFT_ARROW: u16 = 123;
#[cfg(target_os = "macos")]
const KEY_RIGHT_ARROW: u16 = 124;

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn CGEventCreateKeyboardEvent(
        source: *const std::ffi::c_void,
        virtualKey: u16,
        keyDown: bool,
    ) -> *mut std::ffi::c_void;
    fn CGEventSetFlags(event: *mut std::ffi::c_void, flags: u64);
    fn CGEventPost(tap: u32, event: *mut std::ffi::c_void);
    fn CFRelease(cf: *const std::ffi::c_void);
}

#[cfg(target_os = "macos")]
fn inject_key(key_code: u16, ctrl: bool) -> Result<(), String> {
    unsafe {
        let down = CGEventCreateKeyboardEvent(std::ptr::null(), key_code, true);
        if down.is_null() {
            return Err("Failed to create key-down event.".to_string());
        }
        if ctrl {
            CGEventSetFlags(down, kCGEventFlagMaskControl);
        }
        CGEventPost(kCGHIDEventTap, down);
        CFRelease(down);

        let up = CGEventCreateKeyboardEvent(std::ptr::null(), key_code, false);
        if up.is_null() {
            return Err("Failed to create key-up event.".to_string());
        }
        if ctrl {
            CGEventSetFlags(up, kCGEventFlagMaskControl);
        }
        CGEventPost(kCGHIDEventTap, up);
        CFRelease(up);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn is_on_target_space(target_space_id: i64) -> bool {
    cgs::active_space_id()
        .map(|sid| sid == target_space_id)
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn find_space_by_id(spaces: &[SpaceInfo], space_id: i64) -> Option<&SpaceInfo> {
    spaces.iter().find(|s| s.space_id == space_id)
}

#[cfg(target_os = "macos")]
fn wait_for_active_space_change(previous: i64) -> Option<i64> {
    for _ in 0..5 {
        thread::sleep(Duration::from_millis(40));
        if let Some(now) = cgs::active_space_id() {
            if now != previous {
                return Some(now);
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn navigate_via_arrow_steps(
    target_space_id: i64,
    start_index: usize,
    target_index: usize,
) -> Result<(), String> {
    if start_index == target_index {
        return if is_on_target_space(target_space_id) {
            Ok(())
        } else {
            Err("Already at target index, but active space check failed.".to_string())
        };
    }

    let direction_right = target_index > start_index;
    let steps = target_index.abs_diff(start_index);
    let key_code = if direction_right {
        KEY_RIGHT_ARROW
    } else {
        KEY_LEFT_ARROW
    };

    let mut previous = cgs::active_space_id().unwrap_or(0);
    for i in 0..steps {
        inject_key(key_code, true)?;
        match wait_for_active_space_change(previous) {
            Some(now) => previous = now,
            None => {
                return Err(format!(
                    "Space did not change after arrow step {} of {}.",
                    i + 1,
                    steps
                ));
            }
        }

        if previous == target_space_id {
            return Ok(());
        }
    }

    if is_on_target_space(target_space_id) {
        Ok(())
    } else {
        Err("Arrow stepping completed but target space was not reached.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn navigate_via_hotkey_route(
    spaces: &[SpaceInfo],
    current_space_id: i64,
    target_space_id: i64,
    target_index: usize,
) -> Result<(), String> {
    if target_index >= 1 && target_index <= 9 {
        log::info!(
            "[nav] Hotkey route: direct Ctrl+{} jump for target {}.",
            target_index,
            target_space_id
        );
        navigate_via_keyboard(target_index)?;
        return Ok(());
    }

    let target = find_space_by_id(spaces, target_space_id)
        .ok_or_else(|| format!("Target space {} not found in snapshot.", target_space_id))?;

    let anchor = spaces
        .iter()
        .filter(|s| s.display_id == target.display_id && s.space_index <= 9)
        .min_by_key(|s| s.space_index.abs_diff(target_index));

    if let Some(anchor_space) = anchor {
        log::info!(
            "[nav] Hotkey route: anchor Ctrl+{} then step to {}.",
            anchor_space.space_index,
            target_index
        );
        navigate_via_keyboard(anchor_space.space_index)?;
        thread::sleep(Duration::from_millis(100));
        return navigate_via_arrow_steps(target_space_id, anchor_space.space_index, target_index);
    }

    if let Some(current) = find_space_by_id(spaces, current_space_id) {
        if current.display_id == target.display_id {
            log::info!(
                "[nav] Hotkey route: no anchor, stepping from current index {} to {}.",
                current.space_index,
                target_index
            );
            return navigate_via_arrow_steps(target_space_id, current.space_index, target_index);
        }
    }

    Err("No clear hotkey route to target space.".to_string())
}

/// Navigate to a space via keyboard shortcut injection.
///
/// For spaces 1-9: Ctrl+Number (requires user to have enabled these in
///   System Settings > Keyboard > Shortcuts > Mission Control).
/// For spaces > 9: Not directly reachable via shortcut; log a warning.
#[cfg(target_os = "macos")]
fn navigate_via_keyboard(space_index: usize) -> Result<(), String> {
    if space_index < 1 || space_index > 9 {
        return Err(format!(
            "Direct keyboard navigation only supports spaces 1-9. Space {} is out of range.",
            space_index
        ));
    }

    // Key codes for digits 1-9: 18, 19, 20, 21, 23, 22, 26, 28, 25.
    let key_codes: [u16; 9] = [18, 19, 20, 21, 23, 22, 26, 28, 25];
    let key_code = key_codes[space_index - 1];
    inject_key(key_code, true)
}

/// Navigate to a specific window of a named application.
#[cfg(target_os = "macos")]
fn navigate_to_window_macos(
    app_name: &str,
    window_title: &str,
    target_space_id: Option<i64>,
    spaces: &[SpaceInfo],
) -> Result<(), String> {
    log::info!(
        "[nav] Navigating to window '{}' of app '{}'.",
        window_title, app_name
    );
    let primary_result = navigate_via_window(window_title);

    if let Some(target_sid) = target_space_id {
        if is_on_target_space(target_sid) {
            return Ok(());
        }

        if let Some(target) = find_space_by_id(spaces, target_sid) {
            log::warn!(
                "[nav] Window navigation did not land on target space {}; trying hotkey fallback.",
                target_sid
            );
            let current_sid = cgs::active_space_id().unwrap_or(0);
            let _ = navigate_via_hotkey_route(spaces, current_sid, target_sid, target.space_index);
            if is_on_target_space(target_sid) {
                let _ = navigate_via_window(window_title);
                return Ok(());
            }
        }
        return Err(format!(
            "Window navigation failed to reach target space {}.",
            target_sid
        ));
    }

    primary_result
}
