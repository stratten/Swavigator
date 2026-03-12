use log::{LevelFilter, Log, Metadata, Record};
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

static FILE_ENABLED: AtomicBool = AtomicBool::new(false);
static LOG_FILE: Mutex<Option<File>> = Mutex::new(None);
static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

struct SwavigatorLogger;

impl Log for SwavigatorLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= log::Level::Info
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let msg = format!(
            "[{}] [{:5}] [{}] {}\n",
            ts,
            record.level(),
            record.target(),
            record.args()
        );

        eprint!("{}", msg);

        if FILE_ENABLED.load(Ordering::Relaxed) {
            if let Ok(mut guard) = LOG_FILE.lock() {
                if let Some(ref mut f) = *guard {
                    let _ = f.write_all(msg.as_bytes());
                    let _ = f.flush();
                }
            }
        }
    }

    fn flush(&self) {
        if let Ok(mut guard) = LOG_FILE.lock() {
            if let Some(ref mut f) = *guard {
                let _ = f.flush();
            }
        }
    }
}

static LOGGER: SwavigatorLogger = SwavigatorLogger;

/// Initialize the global logger. Call once at startup.
pub fn init() {
    log::set_logger(&LOGGER).expect("Failed to set logger");
    log::set_max_level(LevelFilter::Info);
}

/// Enable file logging. Creates `~/Desktop/Swavigator_Logs/swavigator_<timestamp>.log`.
/// Returns the path to the new log file.
pub fn enable_file_logging() -> Result<PathBuf, String> {
    let desktop = dirs::desktop_dir().ok_or("Could not determine Desktop directory")?;
    let log_dir = desktop.join("Swavigator_Logs");
    std::fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Failed to create log directory: {}", e))?;

    let ts = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let path = log_dir.join(format!("swavigator_{}.log", ts));

    let file =
        File::create(&path).map_err(|e| format!("Failed to create log file: {}", e))?;

    if let Ok(mut guard) = LOG_FILE.lock() {
        *guard = Some(file);
    }
    if let Ok(mut guard) = LOG_PATH.lock() {
        *guard = Some(path.clone());
    }
    FILE_ENABLED.store(true, Ordering::Relaxed);

    log::info!("[logging] File logging enabled → {}", path.display());
    Ok(path)
}

/// Disable file logging and close the active log file.
pub fn disable_file_logging() {
    log::info!("[logging] File logging disabled.");
    FILE_ENABLED.store(false, Ordering::Relaxed);
    if let Ok(mut guard) = LOG_FILE.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = LOG_PATH.lock() {
        *guard = None;
    }
}

/// Returns the path of the currently active log file, if any.
pub fn get_log_file_path() -> Option<PathBuf> {
    LOG_PATH.lock().ok().and_then(|g| g.clone())
}
