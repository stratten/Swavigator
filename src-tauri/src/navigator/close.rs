//! Closing spaces and windows.

/// Close (remove) a macOS space via Mission Control automation.
///
/// Strategy:
///   1. Trigger Mission Control (Ctrl+Up).
///   2. Walk the Dock process's Accessibility tree to find the space thumbnails.
///   3. Hover the target space and click its close (×) button.
///   4. Dismiss Mission Control.
///
/// This is experimental: it relies on the AX hierarchy of Mission Control,
/// which is fragile and may break across macOS versions.
pub fn close_space(space_index: usize) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        close_space_macos(space_index)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = space_index;
        Err("Space closing is only supported on macOS.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn close_space_macos(space_index: usize) -> Result<(), String> {
    let swift_src = format!(
        r#"
import Cocoa

// The 1-based index of the space we want to close.
let targetIndex = {space_index}

fputs("INFO: Attempting to close space \(targetIndex)\n", stderr)

// Helper: get a string attribute from an AX element.
func axString(_ element: AXUIElement, _ attr: String) -> String? {{
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attr as CFString, &ref) == .success else {{ return nil }}
    return ref as? String
}}

// Helper: get children of an AX element.
func axChildren(_ element: AXUIElement) -> [AXUIElement] {{
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &ref) == .success,
          let children = ref as? [AXUIElement] else {{ return [] }}
    return children
}}

// Helper: dump the AX tree up to a certain depth (for diagnostics).
func dumpTree(_ element: AXUIElement, depth: Int = 0, maxDepth: Int = 5) {{
    if depth > maxDepth {{ return }}
    let indent = String(repeating: "  ", count: depth)
    let role = axString(element, kAXRoleAttribute as String) ?? "?"
    let subrole = axString(element, kAXSubroleAttribute as String) ?? ""
    let title = axString(element, kAXTitleAttribute as String) ?? ""
    let desc = axString(element, kAXDescriptionAttribute as String) ?? ""
    let identifier = axString(element, kAXIdentifierAttribute as String) ?? ""
    fputs("\(indent)[\(role)] subrole=\(subrole) title=\"\(title)\" desc=\"\(desc)\" id=\"\(identifier)\"\n", stderr)
    for child in axChildren(element) {{
        dumpTree(child, depth: depth + 1, maxDepth: maxDepth)
    }}
}}

// Helper: recursively find AX elements by role.
func findElements(in element: AXUIElement, role targetRole: String, maxDepth: Int = 15, depth: Int = 0) -> [AXUIElement] {{
    if depth > maxDepth {{ return [] }}
    var results: [AXUIElement] = []
    if let role = axString(element, kAXRoleAttribute as String), role == targetRole {{
        results.append(element)
    }}
    for child in axChildren(element) {{
        results.append(contentsOf: findElements(in: child, role: targetRole, maxDepth: maxDepth, depth: depth + 1))
    }}
    return results
}}

// 1. Open Mission Control.
let mcScript = NSAppleScript(source: """
    tell application "System Events"
        key code 126 using control down
    end tell
""")
mcScript?.executeAndReturnError(nil)
fputs("INFO: Mission Control triggered, waiting 1.5s...\n", stderr)
Thread.sleep(forTimeInterval: 1.5)

// 2. Locate the Dock process (which owns Mission Control's AX elements).
guard let dockApp = NSWorkspace.shared.runningApplications
        .first(where: {{ $0.bundleIdentifier == "com.apple.dock" }}) else {{
    fputs("ERR: Dock process not found.\n", stderr)
    Darwin.exit(1)
}}

let dockRef = AXUIElementCreateApplication(dockApp.processIdentifier)
fputs("INFO: Dock PID = \(dockApp.processIdentifier)\n", stderr)

// Dump the top-level AX tree of the Dock for diagnostics (depth 4).
fputs("INFO: Dock AX tree:\n", stderr)
dumpTree(dockRef, maxDepth: 4)

// 3. Find space buttons in the Mission Control bar.
//    Strategy A: Look for buttons with titles containing "Desktop" or "Space".
var spaceButtons: [AXUIElement] = []

let allButtons = findElements(in: dockRef, role: "AXButton")
fputs("INFO: Total AXButton elements under Dock: \(allButtons.count)\n", stderr)

for btn in allButtons {{
    let title = axString(btn, kAXTitleAttribute as String) ?? ""
    let desc = axString(btn, kAXDescriptionAttribute as String) ?? ""
    let subrole = axString(btn, kAXSubroleAttribute as String) ?? ""
    if !title.isEmpty || !desc.isEmpty {{
        fputs("INFO:   button title=\"\(title)\" desc=\"\(desc)\" subrole=\"\(subrole)\"\n", stderr)
    }}
    // Match space thumbnails by title.
    if title.hasPrefix("Desktop") || title.hasPrefix("Space") || title.contains("Desktop") || desc.contains("desktop") || desc.contains("Desktop") {{
        spaceButtons.append(btn)
    }}
}}

fputs("INFO: Strategy A (title match) found \(spaceButtons.count) space buttons.\n", stderr)

// Strategy B: If no titled buttons, look for AXList children that are buttons.
if spaceButtons.isEmpty {{
    let lists = findElements(in: dockRef, role: "AXList")
    fputs("INFO: Strategy B: found \(lists.count) AXList elements.\n", stderr)
    for list in lists {{
        let buttons = findElements(in: list, role: "AXButton", maxDepth: 3, depth: 0)
        fputs("INFO:   AXList has \(buttons.count) buttons.\n", stderr)
        if buttons.count >= 2 {{
            spaceButtons = buttons
            break
        }}
    }}
    fputs("INFO: Strategy B found \(spaceButtons.count) space buttons.\n", stderr)
}}

// Strategy C: Look for AXGroup children with multiple sub-buttons
// (some macOS versions nest spaces inside groups).
if spaceButtons.isEmpty {{
    let groups = findElements(in: dockRef, role: "AXGroup")
    fputs("INFO: Strategy C: found \(groups.count) AXGroup elements.\n", stderr)
    for group in groups {{
        let buttons = findElements(in: group, role: "AXButton", maxDepth: 3, depth: 0)
        fputs("INFO:   AXGroup has \(buttons.count) buttons.\n", stderr)
        if buttons.count >= 2 {{
            spaceButtons = buttons
            break
        }}
    }}
    fputs("INFO: Strategy C found \(spaceButtons.count) space buttons.\n", stderr)
}}

// Strategy D: Look for DockSpace buttons directly.
if spaceButtons.isEmpty {{
    for btn in allButtons {{
        let subrole = axString(btn, kAXSubroleAttribute as String) ?? ""
        let identifier = axString(btn, kAXIdentifierAttribute as String) ?? ""
        if subrole.lowercased().contains("space") || identifier.lowercased().contains("space") || identifier.lowercased().contains("desktop") {{
            spaceButtons.append(btn)
        }}
    }}
    fputs("INFO: Strategy D (subrole/identifier) found \(spaceButtons.count) space buttons.\n", stderr)
}}

guard targetIndex >= 1, targetIndex <= spaceButtons.count else {{
    // Dismiss Mission Control before exiting.
    let escScript = NSAppleScript(source: """
        tell application "System Events"
            key code 53
        end tell
    """)
    escScript?.executeAndReturnError(nil)
    Thread.sleep(forTimeInterval: 0.3)
    fputs("ERR: Space index \(targetIndex) out of range (found \(spaceButtons.count) space buttons).\n", stderr)
    Darwin.exit(1)
}}

let targetButton = spaceButtons[targetIndex - 1]
fputs("INFO: Selected space button at index \(targetIndex).\n", stderr)

// 4. Move the mouse over the space button to make the close button appear.
var posRef: CFTypeRef?
var sizeRef: CFTypeRef?
if AXUIElementCopyAttributeValue(targetButton, kAXPositionAttribute as CFString, &posRef) == .success,
   AXUIElementCopyAttributeValue(targetButton, kAXSizeAttribute as CFString, &sizeRef) == .success {{
    var pos = CGPoint.zero
    var size = CGSize.zero
    AXValueGetValue(posRef as! AXValue, .cgPoint, &pos)
    AXValueGetValue(sizeRef as! AXValue, .cgSize, &size)

    let centerX = pos.x + size.width / 2.0
    let centerY = pos.y + size.height / 2.0
    fputs("INFO: Space button at (\(pos.x), \(pos.y)) size (\(size.width) x \(size.height)), hovering at (\(centerX), \(centerY)).\n", stderr)

    // Move the cursor to hover over the space.
    CGWarpMouseCursorPosition(CGPoint(x: centerX, y: centerY))
    Thread.sleep(forTimeInterval: 0.6)

    // Re-read the button's children after hovering (close button may appear dynamically).
    let closeButtons = findElements(in: targetButton, role: "AXButton", maxDepth: 3, depth: 0)
    fputs("INFO: Found \(closeButtons.count) sub-buttons after hovering.\n", stderr)
    var closed = false

    for cb in closeButtons {{
        let subrole = axString(cb, kAXSubroleAttribute as String) ?? ""
        let cbTitle = axString(cb, kAXTitleAttribute as String) ?? ""
        fputs("INFO:   sub-button subrole=\"\(subrole)\" title=\"\(cbTitle)\"\n", stderr)
        if subrole == "AXCloseButton" || cbTitle.lowercased().contains("close") {{
            let r = AXUIElementPerformAction(cb, kAXPressAction as CFString)
            fputs("INFO: Pressed close button, result=\(r.rawValue)\n", stderr)
            closed = true
            break
        }}
    }}

    if !closed {{
        // Last resort: search the entire Dock tree for a new close button that appeared.
        fputs("INFO: Searching entire Dock tree for close button...\n", stderr)
        let allBtnsAfterHover = findElements(in: dockRef, role: "AXButton")
        for cb in allBtnsAfterHover {{
            let subrole = axString(cb, kAXSubroleAttribute as String) ?? ""
            let cbTitle = axString(cb, kAXTitleAttribute as String) ?? ""
            if subrole == "AXCloseButton" || cbTitle.lowercased().contains("close") {{
                let r = AXUIElementPerformAction(cb, kAXPressAction as CFString)
                fputs("INFO: Found and pressed close button (tree-wide), result=\(r.rawValue)\n", stderr)
                closed = true
                break
            }}
        }}
    }}

    if !closed {{
        fputs("WARN: Could not find close button for space \(targetIndex).\n", stderr)
    }}
}} else {{
    fputs("WARN: Could not read position/size of space button.\n", stderr)
}}

// 5. Dismiss Mission Control.
Thread.sleep(forTimeInterval: 0.5)
let dismissScript = NSAppleScript(source: """
    tell application "System Events"
        key code 53
    end tell
""")
dismissScript?.executeAndReturnError(nil)
Thread.sleep(forTimeInterval: 0.3)

Darwin.exit(0)
"#
    );

    let output = std::process::Command::new("swift")
        .arg("-e")
        .arg(&swift_src)
        .output()
        .map_err(|e| format!("Failed to execute Swift: {e}"))?;

    let stderr_text = String::from_utf8_lossy(&output.stderr);
    if !stderr_text.is_empty() {
        // Log each line separately for cleaner output.
        for line in stderr_text.lines() {
            if line.starts_with("ERR:") {
                log::error!("[nav] close_space: {}", line);
            } else if line.starts_with("WARN:") {
                log::warn!("[nav] close_space: {}", line);
            } else {
                log::info!("[nav] close_space: {}", line);
            }
        }
    }

    if !output.status.success() {
        return Err(format!("Close space failed: {}", stderr_text.trim()));
    }

    log::info!("[nav] Closed space {}.", space_index);
    Ok(())
}

/// Close a specific window by app name and window title.
///
/// Uses the Accessibility API to find the window's close button and press it.
pub fn close_window(app_name: &str, window_title: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        close_window_macos(app_name, window_title)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app_name, window_title);
        Err("Window closing is only supported on macOS.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn close_window_macos(app_name: &str, window_title: &str) -> Result<(), String> {
    let safe_app = app_name.replace('\\', "\\\\").replace('"', "\\\"");
    let safe_title = window_title.replace('\\', "\\\\").replace('"', "\\\"");

    let swift_src = format!(
        r#"
import Cocoa

let targetApp = "{safe_app}"
let targetTitle = "{safe_title}"

guard let app = NSWorkspace.shared.runningApplications
        .first(where: {{ $0.localizedName == targetApp }}) else {{
    fputs("ERR: App not found: \(targetApp)\n", stderr)
    exit(1)
}}

let appRef = AXUIElementCreateApplication(app.processIdentifier)
var windowsRef: CFTypeRef?
guard AXUIElementCopyAttributeValue(
    appRef, kAXWindowsAttribute as CFString, &windowsRef
) == .success, let axWindows = windowsRef as? [AXUIElement] else {{
    fputs("ERR: Could not get windows for \(targetApp)\n", stderr)
    exit(1)
}}

for axWin in axWindows {{
    var tRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
        axWin, kAXTitleAttribute as CFString, &tRef
    ) == .success, let title = tRef as? String else {{ continue }}

    if title == targetTitle || title.contains(targetTitle) {{
        var closeButtonRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(
            axWin, kAXCloseButtonAttribute as CFString, &closeButtonRef
        ) == .success {{
            let result = AXUIElementPerformAction(
                closeButtonRef as! AXUIElement, kAXPressAction as CFString
            )
            if result == .success {{
                exit(0)
            }}
        }}
        fputs("ERR: Could not press close button.\n", stderr)
        exit(1)
    }}
}}

fputs("ERR: Window not found: \(targetTitle)\n", stderr)
exit(1)
"#
    );

    let output = std::process::Command::new("swift")
        .arg("-e")
        .arg(&swift_src)
        .output()
        .map_err(|e| format!("Failed to execute Swift: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("[nav] close_window script failed: {}", stderr);
        return Err(format!("Close window failed: {}", stderr));
    }

    log::info!(
        "[nav] Closed window '{}' of app '{}'.",
        window_title, app_name
    );
    Ok(())
}
