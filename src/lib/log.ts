import { invoke } from "@tauri-apps/api/core";

/**
 * Log a message to the terminal (via the Rust backend logger).
 * These appear in the terminal where `cargo tauri dev` is running,
 * prefixed with `[fe]`.
 */
function send(level: string, message: string) {
  invoke("log_from_frontend", { level, message }).catch(() => {
    // Swallow silently — logging should never break the app.
  });
}

const devLog = {
  info: (message: string) => send("info", message),
  warn: (message: string) => send("warn", message),
  error: (message: string) => send("error", message),
};

export default devLog;
