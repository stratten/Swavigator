use serde::Serialize;
use std::collections::HashMap;

/// Information about a single application window.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub window_id: u32,
    pub title: String,
    pub app_name: String,
    pub bundle_id: String,
    pub is_minimized: bool,
    pub space_id: i64,
}

/// Enumerate all windows across all spaces and map each to its space.
///
/// Uses CGWindowListCopyWindowInfo to get ALL windows, then
/// CGSCopySpacesForWindows to determine which space each belongs to.
///
/// Returns a map of space_id -> Vec<WindowInfo>.
pub fn enumerate_windows() -> Option<HashMap<i64, Vec<WindowInfo>>> {
    #[cfg(target_os = "macos")]
    {
        enumerate_windows_macos()
    }

    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// macOS implementation using a Swift script that:
/// 1. Calls CGWindowListCopyWindowInfo(.optionAll) to get all windows.
/// 2. Calls CGSCopySpacesForWindows to map each window to its space.
/// 3. Outputs JSON with the combined data.
#[cfg(target_os = "macos")]
fn enumerate_windows_macos() -> Option<HashMap<i64, Vec<WindowInfo>>> {
    let swift_src = r#"
import Foundation
import CoreGraphics
import Cocoa

@_silgen_name("CGSMainConnectionID")
func CGSMainConnectionID() -> Int32

@_silgen_name("CGSCopySpacesForWindows")
func CGSCopySpacesForWindows(_ cid: Int32, _ mask: Int32, _ wids: CFArray) -> CFArray?

let cid = CGSMainConnectionID()

let opts: CGWindowListOption = [.optionAll]
guard let windowList = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
    fputs("ERR: CGWindowListCopyWindowInfo failed.\n", stderr)
    exit(1)
}

// Build a mapping of bundle ID by PID for running apps.
var bundleByPID: [Int32: String] = [:]
for app in NSWorkspace.shared.runningApplications {
    if let bid = app.bundleIdentifier {
        bundleByPID[app.processIdentifier] = bid
    }
}

let skipBundles: Set<String> = [
    "com.apple.dock",
    "com.apple.WindowManager",
    "com.apple.SystemUIServer",
    "com.apple.controlcenter",
    "com.apple.notificationcenterui",
]

// First pass: collect candidate windows and track which apps have titled windows.
struct CandidateWindow {
    let wid: CGWindowID
    let title: String
    let ownerName: String
    let bundleId: String
    let pid: Int32
    let hasCGTitle: Bool  // whether this window had a non-empty kCGWindowName
    let bounds: (Double, Double)?
}

var candidates: [CandidateWindow] = []
var appsWithTitledWindows: Set<String> = []

for w in windowList {
    guard let ownerName = w[kCGWindowOwnerName as String] as? String,
          let wid = w[kCGWindowNumber as String] as? CGWindowID else { continue }

    let title = w[kCGWindowName as String] as? String ?? ""
    let pid = w[kCGWindowOwnerPID as String] as? Int32 ?? 0
    let layer = w[kCGWindowLayer as String] as? Int ?? 0
    let bundleId = bundleByPID[pid] ?? ""

    // Skip non-layer-0 windows (menus, overlays, tooltips, etc.).
    if layer != 0 { continue }
    if skipBundles.contains(bundleId) { continue }

    let windowBounds: (Double, Double)?
    if let b = w[kCGWindowBounds as String] as? [String: Any],
       let bw = b["Width"] as? Double,
       let bh = b["Height"] as? Double {
        windowBounds = (bw, bh)
    } else {
        windowBounds = nil
    }

    if !title.isEmpty {
        appsWithTitledWindows.insert(bundleId.isEmpty ? ownerName : bundleId)
    }

    candidates.append(CandidateWindow(
        wid: wid, title: title, ownerName: ownerName,
        bundleId: bundleId, pid: pid,
        hasCGTitle: !title.isEmpty, bounds: windowBounds
    ))
}

// Second pass: build results, filtering titleless windows intelligently.
var results: [[String: Any]] = []

for c in candidates {
    let appKey = c.bundleId.isEmpty ? c.ownerName : c.bundleId

    if !c.hasCGTitle {
        // Only include titleless windows for apps that have NO titled windows
        // anywhere (i.e., apps that exclusively use custom window types).
        if appsWithTitledWindows.contains(appKey) { continue }

        // Still require reasonable dimensions to exclude tiny helper windows.
        if let (w, h) = c.bounds {
            if w < 100 || h < 50 { continue }
        } else {
            continue
        }
    }

    let displayTitle = c.hasCGTitle ? c.title : c.ownerName

    // Determine which space this window is on.
    var spaceId: Int = 0
    if let spaces = CGSCopySpacesForWindows(cid, 0x7, [c.wid] as CFArray) as? [Int],
       !spaces.isEmpty {
        spaceId = spaces[0]
    }

    // Determine if truly minimised.
    // kCGWindowIsOnscreen is false for ALL windows on non-active spaces,
    // not just minimised ones. A truly minimised window is off-screen
    // AND not mapped to any regular space (spaceId == 0).
    let isOnScreen = windowList.first(where: {
        ($0[kCGWindowNumber as String] as? CGWindowID) == c.wid
    })?[kCGWindowIsOnscreen as String] as? Bool ?? false
    let isMinimized = !isOnScreen && spaceId == 0

    results.append([
        "windowId": Int(c.wid),
        "title": displayTitle,
        "appName": c.ownerName,
        "bundleId": c.bundleId,
        "isMinimized": isMinimized,
        "spaceId": spaceId,
    ])
}

if let jsonData = try? JSONSerialization.data(withJSONObject: results),
   let jsonStr = String(data: jsonData, encoding: .utf8) {
    print(jsonStr)
} else {
    fputs("ERR: JSON serialisation failed.\n", stderr)
    exit(1)
}
"#;

    let output = std::process::Command::new("swift")
        .arg("-e")
        .arg(swift_src)
        .output()
        .ok()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("[windows] Swift script failed: {}", stderr);
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: Vec<serde_json::Value> = serde_json::from_str(stdout.trim()).ok()?;

    let mut by_space: HashMap<i64, Vec<WindowInfo>> = HashMap::new();

    for w in parsed {
        let space_id = w["spaceId"].as_i64().unwrap_or(0);
        let info = WindowInfo {
            window_id: w["windowId"].as_u64().unwrap_or(0) as u32,
            title: w["title"].as_str().unwrap_or("").to_string(),
            app_name: w["appName"].as_str().unwrap_or("").to_string(),
            bundle_id: w["bundleId"].as_str().unwrap_or("").to_string(),
            is_minimized: w["isMinimized"].as_bool().unwrap_or(false),
            space_id,
        };

        by_space.entry(space_id).or_default().push(info);
    }

    Some(by_space)
}
