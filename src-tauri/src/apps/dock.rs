//! Dock interactions: context menus and badge counts via Accessibility API.

use super::AppBadge;

// ---------------------------------------------------------------------------
// Show an app's Dock context menu via the Accessibility API
// ---------------------------------------------------------------------------

/// Trigger the real Dock right-click menu for an app by its display name.
/// This finds the app's dock tile via AX and performs AXShowMenu on it.
pub fn show_dock_menu(app_name: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        show_dock_menu_macos(app_name)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app_name;
        Err("Dock menu is only available on macOS.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn show_dock_menu_macos(app_name: &str) -> Result<(), String> {
    let safe_name = app_name.replace('\\', "\\\\").replace('"', "\\\"");

    let swift_src = format!(
        r#"
import Cocoa

let targetName = "{safe_name}"

// Find the Dock process.
guard let dockApp = NSWorkspace.shared.runningApplications
        .first(where: {{ $0.bundleIdentifier == "com.apple.dock" }}) else {{
    fputs("ERR: Dock process not found.\n", stderr)
    exit(1)
}}

let dockRef = AXUIElementCreateApplication(dockApp.processIdentifier)

// Traverse the Dock's AX tree to find the app's dock tile.
func findDockItem(_ element: AXUIElement, name: String) -> AXUIElement? {{
    var childrenRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
        element, kAXChildrenAttribute as CFString, &childrenRef
    ) == .success, let children = childrenRef as? [AXUIElement] else {{
        return nil
    }}

    for child in children {{
        var titleRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(
            child, kAXTitleAttribute as CFString, &titleRef
        ) == .success, let title = titleRef as? String {{
            if title == name {{
                return child
            }}
        }}

        // Recurse.
        if let found = findDockItem(child, name: name) {{
            return found
        }}
    }}

    return nil
}}

guard let dockItem = findDockItem(dockRef, name: targetName) else {{
    fputs("ERR: Dock item not found for: \(targetName)\n", stderr)
    exit(1)
}}

// Trigger AXShowMenu to pop up the Dock context menu.
let result = AXUIElementPerformAction(dockItem, kAXShowMenuAction as CFString)
if result != .success {{
    fputs("ERR: AXShowMenu failed with code \(result.rawValue)\n", stderr)
    exit(1)
}}
"#
    );

    let output = std::process::Command::new("swift")
        .arg("-e")
        .arg(&swift_src)
        .output()
        .map_err(|e| format!("Failed to run Swift: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Show dock menu failed: {}", stderr));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Read badge counts from the Dock via Accessibility API
// ---------------------------------------------------------------------------

/// Read badge counts for a list of app names by inspecting the Dock's
/// accessibility tree.
pub fn get_app_badge_counts(app_names: &[String]) -> Result<Vec<AppBadge>, String> {
    #[cfg(target_os = "macos")]
    {
        get_app_badge_counts_macos(app_names)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app_names;
        Err("Badge counts are only available on macOS.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn get_app_badge_counts_macos(app_names: &[String]) -> Result<Vec<AppBadge>, String> {
    use std::io::Write;

    // Build a JSON array of the app names to pass via stdin.
    let names_json = serde_json::to_string(app_names)
        .map_err(|e| format!("Failed to serialize app names: {e}"))?;

    let swift_src = r#"
import Cocoa
import Foundation

// Read app names from stdin.
let inputData = FileHandle.standardInput.readDataToEndOfFile()
let appNames: [String] = {
    guard let arr = try? JSONSerialization.jsonObject(with: inputData) as? [String] else {
        return []
    }
    return arr
}()

// Find the Dock process.
guard let dockApp = NSWorkspace.shared.runningApplications
        .first(where: { $0.bundleIdentifier == "com.apple.dock" }) else {
    print("[]")
    exit(0)
}

let dockRef = AXUIElementCreateApplication(dockApp.processIdentifier)

// Helper: recursively find dock item status labels.
func findBadges(_ element: AXUIElement, forNames names: [String]) -> [String: String] {
    var results: [String: String] = [:]

    var childrenRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
        element, kAXChildrenAttribute as CFString, &childrenRef
    ) == .success, let children = childrenRef as? [AXUIElement] else {
        return results
    }

    for child in children {
        var titleRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(
            child, kAXTitleAttribute as CFString, &titleRef
        ) == .success, let title = titleRef as? String {
            if names.contains(title) {
                // Look for status label (badge count).
                var statusRef: CFTypeRef?
                if AXUIElementCopyAttributeValue(
                    child, "AXStatusLabel" as CFString, &statusRef
                ) == .success, let status = statusRef as? String {
                    results[title] = status
                }
            }
        }

        // Recurse into children.
        let childResults = findBadges(child, forNames: names)
        for (k, v) in childResults {
            results[k] = v
        }
    }

    return results
}

let badges = findBadges(dockRef, forNames: appNames)

var output: [[String: String]] = []
for name in appNames {
    output.append(["name": name, "badge": badges[name] ?? ""])
}

if let data = try? JSONSerialization.data(withJSONObject: output, options: []),
   let json = String(data: data, encoding: .utf8) {
    print(json)
}
"#;

    let mut child = std::process::Command::new("swift")
        .arg("-e")
        .arg(swift_src)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run Swift: {e}"))?;

    // Write the JSON app names to stdin.
    if let Some(ref mut stdin) = child.stdin {
        let _ = stdin.write_all(names_json.as_bytes());
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for Swift process: {e}"))?;

    if !output.status.success() {
        // Badge reading is best-effort; don't fail hard.
        log::warn!(
            "[apps] Badge count script failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        return Ok(Vec::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Ok(Vec::new());
    }

    let raw: Vec<std::collections::HashMap<String, String>> =
        serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse badge JSON: {e}"))?;

    Ok(raw
        .into_iter()
        .filter_map(|m| {
            let name = m.get("name")?.clone();
            let badge = m.get("badge").cloned().unwrap_or_default();
            // We use the name as a placeholder for bundle_id; the caller
            // maps name -> bundle_id.
            Some(AppBadge {
                bundle_id: name,
                badge,
            })
        })
        .collect())
}
