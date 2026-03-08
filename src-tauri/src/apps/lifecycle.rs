//! App lifecycle: launching and quitting applications.

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
