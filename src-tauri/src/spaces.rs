use serde::Serialize;

/// Information about a single macOS Space.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceInfo {
    pub space_id: i64,
    pub space_index: usize,
    pub display_id: String,
    pub is_active: bool,
    /// Whether this space is the currently visible (frontmost) space on its display.
    pub is_visible: bool,
    /// Whether this space belongs to the built-in (laptop) display.
    pub is_builtin_display: bool,
}

/// Information about a single display and its spaces.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplaySpaces {
    pub display_id: String,
    pub spaces: Vec<SpaceInfo>,
}

/// Enumerate all spaces across all displays using private CGS APIs.
///
/// Returns a flat list of SpaceInfo structs, each with its display UUID,
/// space ID, and 1-based index within that display.
///
/// Also identifies the currently active space.
pub fn enumerate_spaces() -> Option<Vec<SpaceInfo>> {
    #[cfg(target_os = "macos")]
    {
        enumerate_spaces_macos()
    }

    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// macOS implementation using CGSCopyManagedDisplaySpaces and CGSGetActiveSpace.
///
/// The Swift script calls:
///   - CGSMainConnectionID() to get the window server connection
///   - CGSGetActiveSpace(cid) to get the current space ID
///   - CGSCopyManagedDisplaySpaces(cid) to enumerate all spaces per display
///
/// Output format (one JSON line):
///   {"activeSpaceId": 42, "displays": [{"uuid": "...", "spaces": [{"id": 42, "type": 0}, ...]}]}
#[cfg(target_os = "macos")]
fn enumerate_spaces_macos() -> Option<Vec<SpaceInfo>> {
    let swift_src = r#"
import Foundation
import CoreGraphics
import AppKit

@_silgen_name("CGSMainConnectionID")
func CGSMainConnectionID() -> Int32

@_silgen_name("CGSGetActiveSpace")
func CGSGetActiveSpace(_ cid: Int32) -> Int

@_silgen_name("CGSCopyManagedDisplaySpaces")
func CGSCopyManagedDisplaySpaces(_ cid: Int32) -> CFArray?

let cid = CGSMainConnectionID()
let activeSpace = CGSGetActiveSpace(cid)

guard let displays = CGSCopyManagedDisplaySpaces(cid) as? [[String: Any]] else {
    fputs("ERR: CGSCopyManagedDisplaySpaces failed.\n", stderr)
    exit(1)
}

// Build a set of display UUIDs that correspond to built-in screens.
// NSScreen gives us CGDirectDisplayIDs; CGDisplayIsBuiltin tells us if it's the laptop panel.
var builtinUUIDs = Set<String>()
for screen in NSScreen.screens {
    let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID ?? 0
    if CGDisplayIsBuiltin(screenNumber) != 0 {
        // Map CGDirectDisplayID → UUID via IOKit / CGDisplayCreateUUIDFromDisplayID.
        if let cfUUID = CGDisplayCreateUUIDFromDisplayID(screenNumber) {
            let uuidStr = CFUUIDCreateString(nil, cfUUID.takeUnretainedValue()) as String? ?? ""
            builtinUUIDs.insert(uuidStr)
        }
    }
}

var result: [[String: Any]] = []

for display in displays {
    let uuid = display["Display Identifier"] as? String ?? "unknown"
    guard let spaces = display["Spaces"] as? [[String: Any]] else { continue }

    let isBuiltin = builtinUUIDs.contains(uuid)

    var spaceList: [[String: Any]] = []
    for space in spaces {
        guard let sid = space["ManagedSpaceID"] as? Int else { continue }
        let spaceType = space["type"] as? Int ?? -1
        spaceList.append(["id": sid, "type": spaceType])
    }

    // Extract the currently visible space on this display.
    var currentSpaceId: Int = 0
    if let currentSpace = display["Current Space"] as? [String: Any],
       let csid = currentSpace["ManagedSpaceID"] as? Int {
        currentSpaceId = csid
    }

    result.append(["uuid": uuid, "spaces": spaceList, "isBuiltin": isBuiltin, "currentSpaceId": currentSpaceId])
}

let output: [String: Any] = [
    "activeSpaceId": activeSpace,
    "displays": result
]

if let jsonData = try? JSONSerialization.data(withJSONObject: output),
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
        log::error!("[spaces] Swift script failed: {}", stderr);
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;

    let active_space_id = parsed["activeSpaceId"].as_i64().unwrap_or(0);
    let displays = parsed["displays"].as_array()?;

    let mut all_spaces = Vec::new();
    let mut global_index: usize = 0; // Global counter across all displays.

    for display in displays {
        let uuid = display["uuid"].as_str().unwrap_or("unknown").to_string();
        let is_builtin = display["isBuiltin"].as_bool().unwrap_or(false);
        let current_space_id = display["currentSpaceId"].as_i64().unwrap_or(0);
        let spaces = display["spaces"].as_array();

        if let Some(spaces) = spaces {
            for space in spaces.iter() {
                let space_id = space["id"].as_i64().unwrap_or(0);
                // type == 0 is a regular user space; type == 4 is fullscreen.
                // We include both.
                global_index += 1;
                all_spaces.push(SpaceInfo {
                    space_id,
                    space_index: global_index, // 1-based, continuous across displays.
                    display_id: uuid.clone(),
                    is_active: space_id == active_space_id,
                    is_visible: space_id == current_space_id,
                    is_builtin_display: is_builtin,
                });
            }
        }
    }

    Some(all_spaces)
}
