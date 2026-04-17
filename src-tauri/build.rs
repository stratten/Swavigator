fn main() {
    // SkyLight is a private framework that holds the CGS* symbols we use for
    // active-space queries. Linkers don't search PrivateFrameworks by default,
    // which breaks builds on stock CI runners even though local dev typically
    // works via Xcode's search paths.
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-search=framework=/System/Library/PrivateFrameworks");

    tauri_build::build()
}
