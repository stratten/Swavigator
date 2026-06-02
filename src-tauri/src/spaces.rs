use serde::Serialize;

#[cfg(target_os = "macos")]
use std::{
    collections::HashSet,
    ffi::c_void,
    ptr,
    sync::{Mutex, OnceLock},
};

#[cfg(target_os = "macos")]
use core_foundation::{
    array::{CFArray, CFArrayRef},
    base::{CFType, CFTypeRef, TCFType},
    dictionary::{CFDictionary, CFDictionaryGetValueIfPresent},
    number::CFNumber,
    string::{CFString, CFStringRef},
};

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

#[cfg(target_os = "macos")]
static BUILTIN_DISPLAY_UUIDS: OnceLock<Mutex<Option<HashSet<String>>>> = OnceLock::new();

#[cfg(target_os = "macos")]
pub fn invalidate_display_cache() {
    if let Some(cache) = BUILTIN_DISPLAY_UUIDS.get() {
        if let Ok(mut cached) = cache.lock() {
            *cached = None;
        }
    }
}

/// macOS implementation using CGSCopyManagedDisplaySpaces and CGSGetActiveSpace.
#[cfg(target_os = "macos")]
fn enumerate_spaces_macos() -> Option<Vec<SpaceInfo>> {
    let started = std::time::Instant::now();
    let cid = unsafe { CGSMainConnectionID() };
    let active_space_id = unsafe { CGSGetActiveSpace(cid) };
    let displays_ref = unsafe { CGSCopyManagedDisplaySpaces(cid) };
    if displays_ref.is_null() {
        log::error!("[spaces] CGSCopyManagedDisplaySpaces failed.");
        return None;
    }

    let displays: CFArray = unsafe { CFArray::wrap_under_create_rule(displays_ref) };
    let builtin_uuids = builtin_display_uuids();
    let mut all_spaces = Vec::new();
    let mut global_index: usize = 0; // Global counter across all displays.

    for display_raw in displays.get_all_values() {
        let display_value = unsafe { CFType::wrap_under_get_rule(display_raw as CFTypeRef) };
        let Some(display) = display_value.downcast::<CFDictionary>() else {
            continue;
        };

        let uuid =
            cf_string(&display, "Display Identifier").unwrap_or_else(|| "unknown".to_string());
        let is_builtin = builtin_uuids.contains(&uuid);
        let current_space_id = cf_dictionary(&display, "Current Space")
            .and_then(|current| cf_i64(&current, "ManagedSpaceID"))
            .unwrap_or(0);

        let Some(spaces) = cf_array(&display, "Spaces") else {
            continue;
        };

        for space_raw in spaces.get_all_values() {
            let space_value = unsafe { CFType::wrap_under_get_rule(space_raw as CFTypeRef) };
            let Some(space) = space_value.downcast::<CFDictionary>() else {
                continue;
            };
            let Some(space_id) = cf_i64(&space, "ManagedSpaceID") else {
                continue;
            };

            // type == 0 is a regular user space; type == 4 is fullscreen.
            // We include both, matching the previous Swift-based implementation.
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

    let elapsed = started.elapsed();
    if elapsed > std::time::Duration::from_millis(100) {
        log::info!(
            "[spaces] slow enumeration: spaces={}, elapsed_ms={}",
            all_spaces.len(),
            elapsed.as_millis(),
        );
    }

    Some(all_spaces)
}

#[cfg(target_os = "macos")]
#[link(name = "SkyLight", kind = "framework")]
unsafe extern "C" {
    fn CGSMainConnectionID() -> i32;
    fn CGSGetActiveSpace(cid: i32) -> i64;
    fn CGSCopyManagedDisplaySpaces(cid: i32) -> CFArrayRef;
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGGetActiveDisplayList(
        max_displays: u32,
        displays: *mut u32,
        display_count: *mut u32,
    ) -> i32;
    fn CGDisplayIsBuiltin(display: u32) -> u32;
    fn CGDisplayCreateUUIDFromDisplayID(display: u32) -> CFTypeRef;
}

#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFUUIDCreateString(allocator: *const c_void, uuid: CFTypeRef) -> CFStringRef;
}

#[cfg(target_os = "macos")]
fn builtin_display_uuids() -> HashSet<String> {
    let cache = BUILTIN_DISPLAY_UUIDS.get_or_init(|| Mutex::new(None));
    if let Ok(cached) = cache.lock() {
        if let Some(uuids) = &*cached {
            return uuids.clone();
        }
    }

    let uuids = load_builtin_display_uuids();
    if let Ok(mut cached) = cache.lock() {
        *cached = Some(uuids.clone());
    }

    uuids
}

#[cfg(target_os = "macos")]
fn load_builtin_display_uuids() -> HashSet<String> {
    let mut count = 0;
    let status = unsafe { CGGetActiveDisplayList(0, ptr::null_mut(), &mut count) };
    if status != 0 || count == 0 {
        return HashSet::new();
    }

    let mut display_ids = vec![0_u32; count as usize];
    let status = unsafe { CGGetActiveDisplayList(count, display_ids.as_mut_ptr(), &mut count) };
    if status != 0 {
        return HashSet::new();
    }

    display_ids
        .into_iter()
        .filter(|display_id| unsafe { CGDisplayIsBuiltin(*display_id) } != 0)
        .filter_map(display_uuid_string)
        .collect()
}

#[cfg(target_os = "macos")]
fn display_uuid_string(display_id: u32) -> Option<String> {
    let uuid_ref = unsafe { CGDisplayCreateUUIDFromDisplayID(display_id) };
    if uuid_ref.is_null() {
        return None;
    }

    let uuid = unsafe { CFType::wrap_under_create_rule(uuid_ref) };
    let uuid_string_ref = unsafe { CFUUIDCreateString(ptr::null(), uuid.as_CFTypeRef()) };
    if uuid_string_ref.is_null() {
        return None;
    }

    let uuid_string = unsafe { CFString::wrap_under_create_rule(uuid_string_ref) };
    Some(uuid_string.to_string())
}

#[cfg(target_os = "macos")]
fn cf_value(dict: &CFDictionary, key: &'static str) -> Option<CFType> {
    let key = CFString::from_static_string(key);
    let mut value: *const c_void = ptr::null();
    let found = unsafe {
        CFDictionaryGetValueIfPresent(
            dict.as_concrete_TypeRef(),
            key.as_CFTypeRef() as *const c_void,
            &mut value,
        )
    };

    if found == 0 || value.is_null() {
        return None;
    }

    Some(unsafe { CFType::wrap_under_get_rule(value as CFTypeRef) })
}

#[cfg(target_os = "macos")]
fn cf_string(dict: &CFDictionary, key: &'static str) -> Option<String> {
    cf_value(dict, key)
        .and_then(|value| value.downcast::<CFString>())
        .map(|value| value.to_string())
}

#[cfg(target_os = "macos")]
fn cf_i64(dict: &CFDictionary, key: &'static str) -> Option<i64> {
    cf_value(dict, key)
        .and_then(|value| value.downcast::<CFNumber>())
        .and_then(|value| value.to_i64())
}

#[cfg(target_os = "macos")]
fn cf_dictionary(dict: &CFDictionary, key: &'static str) -> Option<CFDictionary> {
    cf_value(dict, key).and_then(|value| value.downcast::<CFDictionary>())
}

#[cfg(target_os = "macos")]
fn cf_array(dict: &CFDictionary, key: &'static str) -> Option<CFArray> {
    cf_value(dict, key).and_then(|value| value.downcast::<CFArray>())
}
