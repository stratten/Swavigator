//! Space and window navigation.

/// Navigate to a specific space by index (1-based).
///
/// Strategy:
///   1. If a window exists in the target space, use Application Exposé
///      to navigate via that window (proven approach from CursorTracker).
///   2. Otherwise, fall back to keyboard shortcut injection (Ctrl+1-9).
///   3. For spaces > 9, use sequential Ctrl+Arrow navigation.
pub fn navigate_to_space(
    space_index: usize,
    current_space_id: i64,
    target_space_id: i64,
    window_title_in_target: Option<&str>,
) -> Result<(), String> {
    if current_space_id == target_space_id {
        return Ok(()); // Already on this space.
    }

    #[cfg(target_os = "macos")]
    {
        // If we have a window in the target space, navigate via that window.
        if let Some(title) = window_title_in_target {
            log::info!(
                "[nav] Navigating to space {} via window '{}'.",
                space_index, title
            );
            return navigate_via_window(title);
        }

        // No window available — use keyboard shortcut.
        log::info!(
            "[nav] No window in target space {}. Using keyboard shortcut.",
            space_index
        );
        navigate_via_keyboard(space_index)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (space_index, window_title_in_target);
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
pub fn navigate_to_window(app_name: &str, window_title: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        navigate_to_window_macos(app_name, window_title)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app_name, window_title);
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

    let script = format!(
        r#"
tell application "System Events"
    key code {} using control down
end tell
"#,
        key_code
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to execute osascript: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Keyboard navigation failed: {}", stderr));
    }

    Ok(())
}

/// Navigate to a specific window of a named application.
#[cfg(target_os = "macos")]
fn navigate_to_window_macos(app_name: &str, window_title: &str) -> Result<(), String> {
    log::info!(
        "[nav] Navigating to window '{}' of app '{}'.",
        window_title, app_name
    );
    navigate_via_window(window_title)
}
