//! App discovery: Dock apps, installed apps, running apps.

use super::DiscoverableApp;

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
