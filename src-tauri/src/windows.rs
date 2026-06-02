use serde::Serialize;
use std::collections::HashMap;

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
    boolean::CFBoolean,
    dictionary::{CFDictionary, CFDictionaryGetValueIfPresent},
    number::CFNumber,
    string::{CFString, CFStringRef},
};

#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};

#[cfg(target_os = "macos")]
use objc::runtime::Object;

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

#[cfg(target_os = "macos")]
static RUNNING_APPS_BY_PID: OnceLock<Mutex<Option<HashMap<i32, RunningAppInfo>>>> = OnceLock::new();

#[cfg(target_os = "macos")]
pub fn invalidate_running_app_cache() {
    if let Some(cache) = RUNNING_APPS_BY_PID.get() {
        if let Ok(mut cached) = cache.lock() {
            *cached = None;
        }
    }
}

/// macOS implementation using CGWindowListCopyWindowInfo and CGSCopySpacesForWindows.
#[cfg(target_os = "macos")]
fn enumerate_windows_macos() -> Option<HashMap<i64, Vec<WindowInfo>>> {
    let started = std::time::Instant::now();
    let cid = unsafe { CGSMainConnectionID() };
    let window_list_ref = unsafe { CGWindowListCopyWindowInfo(K_CG_WINDOW_LIST_OPTION_ALL, 0) };
    if window_list_ref.is_null() {
        log::error!("[windows] CGWindowListCopyWindowInfo failed.");
        return None;
    }

    let running_apps = running_apps_by_pid();
    let skip_bundles = skip_bundles();
    let skip_owners = skip_owners();
    let window_list: CFArray = unsafe { CFArray::wrap_under_create_rule(window_list_ref) };
    let mut candidates = Vec::new();
    let mut apps_with_titled_windows = HashSet::new();

    for window_raw in window_list.get_all_values() {
        let window_value = unsafe { CFType::wrap_under_get_rule(window_raw as CFTypeRef) };
        let Some(window) = window_value.downcast::<CFDictionary>() else {
            continue;
        };

        let Some(owner_name) = cf_string(&window, "kCGWindowOwnerName") else {
            continue;
        };
        let Some(window_id) = cf_i64(&window, "kCGWindowNumber").map(|id| id as u32) else {
            continue;
        };

        let title = cf_string(&window, "kCGWindowName").unwrap_or_default();
        let pid = cf_i64(&window, "kCGWindowOwnerPID").unwrap_or(0) as i32;
        let layer = cf_i64(&window, "kCGWindowLayer").unwrap_or(0);
        let bundle_id = running_apps
            .get(&pid)
            .map(|app| app.bundle_id.clone())
            .unwrap_or_default();

        if layer != 0 {
            continue;
        }
        if skip_bundles.contains(bundle_id.as_str()) {
            continue;
        }
        if skip_owners.contains(owner_name.as_str()) {
            continue;
        }
        if running_apps.get(&pid).is_some_and(|app| !app.is_regular) {
            continue;
        }

        let bounds = cf_dictionary(&window, "kCGWindowBounds")
            .and_then(|bounds| Some((cf_f64(&bounds, "Width")?, cf_f64(&bounds, "Height")?)));

        if !title.is_empty() {
            apps_with_titled_windows.insert(app_key(&bundle_id, &owner_name));
        }

        candidates.push(CandidateWindow {
            window_id,
            title,
            owner_name,
            bundle_id,
            pid,
            bounds,
        });
    }

    let mut by_space: HashMap<i64, Vec<WindowInfo>> = HashMap::new();
    let mut seen_windows = HashSet::new();
    let candidate_count = candidates.len();
    let ax_started = std::time::Instant::now();
    let mut ax_checks = 0_usize;

    for candidate in candidates {
        let app_key = app_key(&candidate.bundle_id, &candidate.owner_name);
        let has_cg_title = !candidate.title.is_empty();

        if !has_cg_title {
            if apps_with_titled_windows.contains(&app_key) {
                continue;
            }

            let Some((width, height)) = candidate.bounds else {
                continue;
            };
            if width < 100.0 || height < 50.0 {
                continue;
            }
        }

        let display_title = if has_cg_title {
            candidate.title.clone()
        } else {
            candidate.owner_name.clone()
        };
        let space_id = space_for_window(cid, candidate.window_id).unwrap_or(0);
        let dedupe_key = format!("{app_key}|{display_title}|{space_id}");
        if !seen_windows.insert(dedupe_key) {
            continue;
        }

        ax_checks += 1;
        let (found_in_ax, is_minimized) = check_window_in_ax(candidate.pid, &display_title);
        if space_id == 0 && !found_in_ax {
            continue;
        }
        if space_id == 0 && found_in_ax && !is_minimized {
            continue;
        }

        let final_space_id = if is_minimized { 0 } else { space_id };
        by_space
            .entry(final_space_id)
            .or_default()
            .push(WindowInfo {
                window_id: candidate.window_id,
                title: display_title,
                app_name: candidate.owner_name,
                bundle_id: candidate.bundle_id,
                is_minimized,
                space_id: final_space_id,
            });
    }

    let elapsed = started.elapsed();
    let ax_elapsed = ax_started.elapsed();
    if elapsed > std::time::Duration::from_millis(250)
        || ax_elapsed > std::time::Duration::from_millis(150)
    {
        let result_count: usize = by_space.values().map(Vec::len).sum();
        log::info!(
            "[windows] slow enumeration: candidates={}, results={}, ax_checks={}, elapsed_ms={}, ax_phase_ms={}",
            candidate_count,
            result_count,
            ax_checks,
            elapsed.as_millis(),
            ax_elapsed.as_millis(),
        );
    }

    Some(by_space)
}

#[cfg(target_os = "macos")]
const K_CG_WINDOW_LIST_OPTION_ALL: u32 = 0;

#[cfg(target_os = "macos")]
#[derive(Clone)]
struct RunningAppInfo {
    bundle_id: String,
    is_regular: bool,
}

#[cfg(target_os = "macos")]
struct CandidateWindow {
    window_id: u32,
    title: String,
    owner_name: String,
    bundle_id: String,
    pid: i32,
    bounds: Option<(f64, f64)>,
}

#[cfg(target_os = "macos")]
#[link(name = "SkyLight", kind = "framework")]
unsafe extern "C" {
    fn CGSMainConnectionID() -> i32;
    fn CGSCopySpacesForWindows(cid: i32, mask: i32, window_ids: CFArrayRef) -> CFArrayRef;
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGWindowListCopyWindowInfo(option: u32, relative_to_window: u32) -> CFArrayRef;
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
fn running_apps_by_pid() -> HashMap<i32, RunningAppInfo> {
    let cache = RUNNING_APPS_BY_PID.get_or_init(|| Mutex::new(None));
    if let Ok(cached) = cache.lock() {
        if let Some(apps) = &*cached {
            return apps.clone();
        }
    }

    let apps = load_running_apps_by_pid();
    if let Ok(mut cached) = cache.lock() {
        *cached = Some(apps.clone());
    }

    apps
}

#[cfg(target_os = "macos")]
fn load_running_apps_by_pid() -> HashMap<i32, RunningAppInfo> {
    let mut result = HashMap::new();

    unsafe {
        let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace.is_null() {
            return result;
        }

        let apps: *mut Object = msg_send![workspace, runningApplications];
        if apps.is_null() {
            return result;
        }

        let count: usize = msg_send![apps, count];
        for index in 0..count {
            let app: *mut Object = msg_send![apps, objectAtIndex: index];
            if app.is_null() {
                continue;
            }

            let pid: i32 = msg_send![app, processIdentifier];
            let bundle_id_obj: *mut Object = msg_send![app, bundleIdentifier];
            let bundle_id = ns_string(bundle_id_obj).unwrap_or_default();
            let activation_policy: isize = msg_send![app, activationPolicy];

            result.insert(
                pid,
                RunningAppInfo {
                    bundle_id,
                    is_regular: activation_policy == 0,
                },
            );
        }
    }

    result
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

#[cfg(target_os = "macos")]
fn space_for_window(cid: i32, window_id: u32) -> Option<i64> {
    let window_number = CFNumber::from(window_id as i64);
    let window_ids = CFArray::from_CFTypes(&[window_number]);
    let spaces_ref = unsafe { CGSCopySpacesForWindows(cid, 0x7, window_ids.as_concrete_TypeRef()) };
    if spaces_ref.is_null() {
        return None;
    }

    let spaces: CFArray = unsafe { CFArray::wrap_under_create_rule(spaces_ref) };
    let first = spaces.get_all_values().into_iter().next()?;
    let value = unsafe { CFType::wrap_under_get_rule(first as CFTypeRef) };
    value
        .downcast::<CFNumber>()
        .and_then(|number| number.to_i64())
}

#[cfg(target_os = "macos")]
fn check_window_in_ax(pid: i32, window_title: &str) -> (bool, bool) {
    let app_ref = unsafe { AXUIElementCreateApplication(pid) };
    if app_ref.is_null() {
        return (false, false);
    }

    let app = unsafe { CFType::wrap_under_create_rule(app_ref) };
    let Some(windows) =
        ax_attribute(&app, "AXWindows").and_then(|value| value.downcast::<CFArray>())
    else {
        return (false, false);
    };

    for window_raw in windows.get_all_values() {
        let window = unsafe { CFType::wrap_under_get_rule(window_raw as CFTypeRef) };
        let Some(title) = ax_attribute(&window, "AXTitle")
            .and_then(|value| value.downcast::<CFString>())
            .map(|value| value.to_string())
        else {
            continue;
        };

        if title == window_title || title.contains(window_title) || window_title.contains(&title) {
            let is_minimized = ax_attribute(&window, "AXMinimized")
                .and_then(|value| value.downcast::<CFBoolean>())
                .map(bool::from)
                .unwrap_or(false);
            return (true, is_minimized);
        }
    }

    (false, false)
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
fn app_key(bundle_id: &str, owner_name: &str) -> String {
    if bundle_id.is_empty() {
        owner_name.to_string()
    } else {
        bundle_id.to_string()
    }
}

#[cfg(target_os = "macos")]
fn skip_bundles() -> HashSet<&'static str> {
    HashSet::from([
        "com.apple.dock",
        "com.apple.WindowManager",
        "com.apple.SystemUIServer",
        "com.apple.controlcenter",
        "com.apple.notificationcenterui",
        "com.apple.loginwindow",
        "com.apple.Spotlight",
        "com.apple.LocalAuthenticationRemoteService",
        "com.apple.AmbientDisplayAgent",
        "com.apple.universalaccessd",
        "com.apple.backgroundtaskmanagementagent",
        "com.apple.coreservices.uiagent",
    ])
}

#[cfg(target_os = "macos")]
fn skip_owners() -> HashSet<&'static str> {
    HashSet::from([
        "loginwindow",
        "Spotlight",
        "LocalAuthenticationRemoteService",
        "Open and Save Panel Service",
        "Privacy & Security",
        "wine64-preloader",
    ])
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
fn cf_f64(dict: &CFDictionary, key: &'static str) -> Option<f64> {
    cf_value(dict, key)
        .and_then(|value| value.downcast::<CFNumber>())
        .and_then(|value| value.to_f64())
}

#[cfg(target_os = "macos")]
fn cf_dictionary(dict: &CFDictionary, key: &'static str) -> Option<CFDictionary> {
    cf_value(dict, key).and_then(|value| value.downcast::<CFDictionary>())
}
