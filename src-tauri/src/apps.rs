use serde::Serialize;

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

// ---------------------------------------------------------------------------
// Read current Dock items from the user's Dock plist
// ---------------------------------------------------------------------------

/// Read persistent application entries from ~/Library/Preferences/com.apple.dock.plist.
pub fn get_dock_apps() -> Result<Vec<DiscoverableApp>, String> {
    #[cfg(target_os = "macos")]
    {
        get_dock_apps_macos()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Dock reading is only available on macOS.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn get_dock_apps_macos() -> Result<Vec<DiscoverableApp>, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory.")?;
    let plist_path = home
        .join("Library")
        .join("Preferences")
        .join("com.apple.dock.plist");

    let value = plist::Value::from_file(&plist_path)
        .map_err(|e| format!("Failed to read dock plist: {}", e))?;

    let dict = value.as_dictionary().ok_or("Dock plist is not a dictionary.")?;

    let persistent_apps = dict
        .get("persistent-apps")
        .and_then(|v| v.as_array())
        .ok_or("No persistent-apps key in dock plist.")?;

    let mut apps = Vec::new();

    for item in persistent_apps {
        let item_dict = match item.as_dictionary() {
            Some(d) => d,
            None => continue,
        };

        let tile_data = match item_dict.get("tile-data").and_then(|v| v.as_dictionary()) {
            Some(d) => d,
            None => continue,
        };

        let bundle_id = tile_data
            .get("bundle-identifier")
            .and_then(|v| v.as_string())
            .unwrap_or("")
            .to_string();

        let name = tile_data
            .get("file-label")
            .and_then(|v| v.as_string())
            .unwrap_or("")
            .to_string();

        if !bundle_id.is_empty() && !name.is_empty() {
            apps.push(DiscoverableApp { bundle_id, name });
        }
    }

    Ok(apps)
}

// ---------------------------------------------------------------------------
// Enumerate installed applications in /Applications
// ---------------------------------------------------------------------------

/// Enumerate applications in /Applications (and ~/Applications).
pub fn get_installed_apps() -> Result<Vec<DiscoverableApp>, String> {
    #[cfg(target_os = "macos")]
    {
        get_installed_apps_macos()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Installed app enumeration is only available on macOS.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn get_installed_apps_macos() -> Result<Vec<DiscoverableApp>, String> {
    let swift_src = r#"
import Foundation

let fm = FileManager.default
var results: [[String: String]] = []

let searchPaths = ["/Applications", "/System/Applications"]

for basePath in searchPaths {
    guard let enumerator = fm.enumerator(
        at: URL(fileURLWithPath: basePath),
        includingPropertiesForKeys: [.isApplicationKey],
        options: [.skipsHiddenFiles],
        errorHandler: nil
    ) else { continue }

    for case let url as URL in enumerator {
        guard url.pathExtension == "app" else { continue }
        // Don't descend into .app bundles.
        enumerator.skipDescendants()

        guard let bundle = Bundle(url: url),
              let bundleId = bundle.bundleIdentifier else { continue }

        let name = fm.displayName(atPath: url.path)
            .replacingOccurrences(of: ".app", with: "")

        results.append(["bundleId": bundleId, "name": name])
    }
}

// Also check ~/Applications.
if let home = fm.homeDirectoryForCurrentUser as URL? {
    let userApps = home.appendingPathComponent("Applications")
    if let enumerator = fm.enumerator(
        at: userApps,
        includingPropertiesForKeys: [.isApplicationKey],
        options: [.skipsHiddenFiles],
        errorHandler: nil
    ) {
        for case let url as URL in enumerator {
            guard url.pathExtension == "app" else { continue }
            enumerator.skipDescendants()

            guard let bundle = Bundle(url: url),
                  let bundleId = bundle.bundleIdentifier else { continue }

            let name = fm.displayName(atPath: url.path)
                .replacingOccurrences(of: ".app", with: "")

            results.append(["bundleId": bundleId, "name": name])
        }
    }
}

// Sort by name.
results.sort { ($0["name"] ?? "") < ($1["name"] ?? "") }

// Output as JSON.
if let data = try? JSONSerialization.data(withJSONObject: results, options: []),
   let json = String(data: data, encoding: .utf8) {
    print(json)
}
"#;

    let output = std::process::Command::new("swift")
        .arg("-e")
        .arg(swift_src)
        .output()
        .map_err(|e| format!("Failed to run Swift: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Installed apps enumeration failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Ok(Vec::new());
    }

    let raw: Vec<std::collections::HashMap<String, String>> =
        serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse installed apps JSON: {e}"))?;

    Ok(raw
        .into_iter()
        .filter_map(|mut m| {
            let bundle_id = m.remove("bundleId")?;
            let name = m.remove("name")?;
            Some(DiscoverableApp { bundle_id, name })
        })
        .collect())
}

// ---------------------------------------------------------------------------
// List currently running applications
// ---------------------------------------------------------------------------

/// List currently running GUI applications.
pub fn get_running_apps() -> Result<Vec<DiscoverableApp>, String> {
    #[cfg(target_os = "macos")]
    {
        get_running_apps_macos()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Running apps listing is only available on macOS.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn get_running_apps_macos() -> Result<Vec<DiscoverableApp>, String> {
    let swift_src = r#"
import Cocoa
import Foundation

var results: [[String: String]] = []

for app in NSWorkspace.shared.runningApplications {
    guard app.activationPolicy == .regular,
          let bundleId = app.bundleIdentifier,
          let name = app.localizedName else { continue }

    results.append(["bundleId": bundleId, "name": name])
}

results.sort { ($0["name"] ?? "") < ($1["name"] ?? "") }

if let data = try? JSONSerialization.data(withJSONObject: results, options: []),
   let json = String(data: data, encoding: .utf8) {
    print(json)
}
"#;

    let output = std::process::Command::new("swift")
        .arg("-e")
        .arg(swift_src)
        .output()
        .map_err(|e| format!("Failed to run Swift: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Running apps listing failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Ok(Vec::new());
    }

    let raw: Vec<std::collections::HashMap<String, String>> =
        serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse running apps JSON: {e}"))?;

    Ok(raw
        .into_iter()
        .filter_map(|mut m| {
            let bundle_id = m.remove("bundleId")?;
            let name = m.remove("name")?;
            Some(DiscoverableApp { bundle_id, name })
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Launch (or activate) an application by bundle ID
// ---------------------------------------------------------------------------

/// Launch or bring to front an application by its bundle identifier.
pub fn launch_app(bundle_id: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        launch_app_macos(bundle_id)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = bundle_id;
        Err("App launching is only available on macOS.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn launch_app_macos(bundle_id: &str) -> Result<(), String> {
    let swift_src = format!(
        r#"
import Cocoa

let bundleId = "{bundle_id}"

guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {{
    fputs("ERR: App not found for bundle ID: \(bundleId)\n", stderr)
    exit(1)
}}

let config = NSWorkspace.OpenConfiguration()
config.activates = true

let semaphore = DispatchSemaphore(value: 0)
var launchError: Error?

NSWorkspace.shared.openApplication(at: url, configuration: config) {{ _, error in
    launchError = error
    semaphore.signal()
}}

semaphore.wait()

if let error = launchError {{
    fputs("ERR: Failed to launch: \(error.localizedDescription)\n", stderr)
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
        return Err(format!("App launch failed: {}", stderr));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Quit (terminate) an application
// ---------------------------------------------------------------------------

/// Quit a running application by its bundle identifier.
pub fn quit_app(bundle_id: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        quit_app_macos(bundle_id)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = bundle_id;
        Err("App quitting is only available on macOS.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn quit_app_macos(bundle_id: &str) -> Result<(), String> {
    let swift_src = format!(
        r#"
import Cocoa

let bundleId = "{bundle_id}"
let apps = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)

if apps.isEmpty {{
    fputs("ERR: No running app found for bundle ID: \(bundleId)\n", stderr)
    exit(1)
}}

for app in apps {{
    app.terminate()
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
        return Err(format!("App quit failed: {}", stderr));
    }

    Ok(())
}

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
        .map_err(|e| format!("Failed to serialise app names: {e}"))?;

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

// ---------------------------------------------------------------------------
// Open a file/folder by path
// ---------------------------------------------------------------------------

/// Open a file or folder in its default application (Finder for folders).
pub fn open_path(path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        open_path_macos(path)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Path opening is only available on macOS.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn open_path_macos(path: &str) -> Result<(), String> {
    let swift_src = format!(
        r#"
import Cocoa

let path = "{path}"
let url = URL(fileURLWithPath: path)

if !NSWorkspace.shared.open(url) {{
    fputs("ERR: Failed to open path: \(path)\n", stderr)
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
        return Err(format!("Path open failed: {}", stderr));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Open a URL in the default browser
// ---------------------------------------------------------------------------

/// Open a URL in the user's default web browser.
pub fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        open_url_macos(url)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = url;
        Err("URL opening is only available on macOS.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn open_url_macos(url: &str) -> Result<(), String> {
    let swift_src = format!(
        r#"
import Cocoa

guard let url = URL(string: "{url}") else {{
    fputs("ERR: Invalid URL: {url}\n", stderr)
    exit(1)
}}

if !NSWorkspace.shared.open(url) {{
    fputs("ERR: Failed to open URL: {url}\n", stderr)
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
        return Err(format!("URL open failed: {}", stderr));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Get icon for an arbitrary file/folder path
// ---------------------------------------------------------------------------

/// Return a base64-encoded PNG icon for any file or folder path.
pub fn get_path_icon(path: &str) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        get_path_icon_macos(path)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Path icons are only available on macOS.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn get_path_icon_macos(path: &str) -> Result<String, String> {
    let swift_src = format!(
        r#"
import Cocoa
import Foundation

let icon = NSWorkspace.shared.icon(forFile: "{path}")
icon.size = NSSize(width: 32, height: 32)

let bitmapRep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: 32,
    pixelsHigh: 32,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
)!

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmapRep)
icon.draw(in: NSRect(x: 0, y: 0, width: 32, height: 32))
NSGraphicsContext.restoreGraphicsState()

guard let pngData = bitmapRep.representation(using: .png, properties: [:]) else {{
    fputs("ERR: Failed to create PNG.\n", stderr)
    exit(1)
}}

print(pngData.base64EncodedString())
"#
    );

    let output = std::process::Command::new("swift")
        .arg("-e")
        .arg(&swift_src)
        .output()
        .map_err(|e| format!("Failed to run Swift: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Path icon lookup failed: {}", stderr));
    }

    let b64 = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(format!("data:image/png;base64,{b64}"))
}
