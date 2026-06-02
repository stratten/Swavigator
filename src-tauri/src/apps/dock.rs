//! Dock interactions: context menus and badge counts via Accessibility API.

use super::AppBadge;

#[cfg(target_os = "macos")]
use std::{
    collections::{HashMap, HashSet},
    ptr,
};

#[cfg(target_os = "macos")]
use core_foundation::{
    array::CFArray,
    base::{CFType, CFTypeRef, TCFType},
    string::{CFString, CFStringRef},
};

#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};

#[cfg(target_os = "macos")]
use objc::runtime::Object;

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
    let Some(dock_pid) = dock_pid() else {
        return Ok(Vec::new());
    };

    let dock_ref = unsafe { AXUIElementCreateApplication(dock_pid) };
    if dock_ref.is_null() {
        return Ok(Vec::new());
    }

    let dock = unsafe { CFType::wrap_under_create_rule(dock_ref) };
    let names: HashSet<String> = app_names.iter().cloned().collect();
    let mut badges = HashMap::new();
    collect_badges(&dock, &names, &mut badges);

    Ok(app_names
        .iter()
        .map(|name| AppBadge {
            // We use the name as a placeholder for bundle_id; the caller maps
            // name -> bundle_id.
            bundle_id: name.clone(),
            badge: badges.get(name).cloned().unwrap_or_default(),
        })
        .collect())
}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
    fn AXUIElementCopyAttributeValue(
        element: CFTypeRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> i32;
}

#[cfg(target_os = "macos")]
fn dock_pid() -> Option<i32> {
    unsafe {
        let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace.is_null() {
            return None;
        }

        let apps: *mut Object = msg_send![workspace, runningApplications];
        if apps.is_null() {
            return None;
        }

        let count: usize = msg_send![apps, count];
        for index in 0..count {
            let app: *mut Object = msg_send![apps, objectAtIndex: index];
            if app.is_null() {
                continue;
            }

            let bundle_id_obj: *mut Object = msg_send![app, bundleIdentifier];
            if ns_string(bundle_id_obj).as_deref() == Some("com.apple.dock") {
                let pid: i32 = msg_send![app, processIdentifier];
                return Some(pid);
            }
        }
    }

    None
}

#[cfg(target_os = "macos")]
fn collect_badges(
    element: &CFType,
    names: &HashSet<String>,
    results: &mut HashMap<String, String>,
) {
    let Some(children) =
        ax_attribute(element, "AXChildren").and_then(|value| value.downcast::<CFArray>())
    else {
        return;
    };

    for child_raw in children.get_all_values() {
        let child = unsafe { CFType::wrap_under_get_rule(child_raw as CFTypeRef) };
        if let Some(title) = ax_attribute(&child, "AXTitle")
            .and_then(|value| value.downcast::<CFString>())
            .map(|value| value.to_string())
        {
            if names.contains(&title) {
                if let Some(status) = ax_attribute(&child, "AXStatusLabel")
                    .and_then(|value| value.downcast::<CFString>())
                    .map(|value| value.to_string())
                {
                    results.insert(title, status);
                }
            }
        }

        collect_badges(&child, names, results);
    }
}

#[cfg(target_os = "macos")]
fn ax_attribute(element: &CFType, attribute: &'static str) -> Option<CFType> {
    let attribute = CFString::from_static_string(attribute);
    let mut value: CFTypeRef = ptr::null();
    let status = unsafe {
        AXUIElementCopyAttributeValue(
            element.as_CFTypeRef(),
            attribute.as_concrete_TypeRef(),
            &mut value,
        )
    };

    if status != 0 || value.is_null() {
        return None;
    }

    Some(unsafe { CFType::wrap_under_create_rule(value) })
}

#[cfg(target_os = "macos")]
fn ns_string(value: *mut Object) -> Option<String> {
    if value.is_null() {
        return None;
    }

    let c_string: *const std::os::raw::c_char = unsafe { msg_send![value, UTF8String] };
    if c_string.is_null() {
        return None;
    }

    Some(
        unsafe { std::ffi::CStr::from_ptr(c_string) }
            .to_string_lossy()
            .into_owned(),
    )
}
