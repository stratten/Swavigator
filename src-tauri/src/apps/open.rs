//! Opening files, folders, URLs, and fetching path icons.

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
