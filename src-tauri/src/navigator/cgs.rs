//! Lightweight wrappers around private CGS space APIs.

#[cfg(target_os = "macos")]
#[link(name = "SkyLight", kind = "framework")]
unsafe extern "C" {
    fn CGSMainConnectionID() -> i32;
    fn CGSGetActiveSpace(cid: i32) -> i64;
}

/// Returns the currently active macOS space ID.
pub fn active_space_id() -> Option<i64> {
    #[cfg(target_os = "macos")]
    unsafe {
        let cid = CGSMainConnectionID();
        Some(CGSGetActiveSpace(cid))
    }

    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}
