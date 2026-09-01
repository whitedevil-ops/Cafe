//! Plain-text diagnostic logs the app writes its own key lifecycle events to.
//!
//! This exists because `eprintln!` goes nowhere useful for a
//! `windows_subsystem = "windows"` build (no attached console, and redirecting
//! stdout/stderr around a fresh process launch did not reliably capture
//! anything either): a café's own staff, or anyone remote-diagnosing over
//! their shoulder, can open these files directly instead.
//!
//! Lifted verbatim out of `bridge.rs`, which is where this pattern was first
//! written, rather than copied into the updater as a second private near-copy.
//! Two subsystems now need exactly the same "append a stamped line to a capped
//! file, never panic, never complain" behaviour, and the version that drifts
//! is the one nobody notices has stopped writing. `bridge.rs` keeps its own
//! one-line `log_line` wrapper over this, so every one of its call sites and
//! its tests are untouched by the move.
//!
//! Each subsystem passes its own file name and gets its own file, deliberately.
//! The bridge logs a burst of lines every launch and the updater logs about
//! six; sharing one file would mean the bridge's chatter can trip the size cap
//! below and wipe an update trace that was the only record of why a till sat
//! on the old version. Separate files also match how these get read — "why
//! isn't it printing" and "why didn't it update" are different questions.
//!
//! Best-effort only — a failed log write is not itself logged, to avoid a loop
//! chasing its own tail.

use std::fs;
use std::path::PathBuf;

use tauri::Manager;

fn log_path(app: &tauri::AppHandle, file: &str) -> Option<PathBuf> {
    let dir = app.path().app_local_data_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join(file))
}

pub fn log_line(app: &tauri::AppHandle, file: &str, line: &str) {
    let Some(path) = log_path(app, file) else { return };
    let stamped = format!("{} {line}\n", chrono::Utc::now().to_rfc3339());
    // Capped rather than left to grow forever — a machine that's been running
    // this for months must not slowly fill a café PC's disk. 64 KiB
    // comfortably holds several days of the sparse events this actually logs
    // (startup, first-success, and errors — not every routine 4-second poll).
    const MAX_BYTES: u64 = 64 * 1024;
    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > MAX_BYTES {
            let _ = fs::write(&path, "");
        }
    }
    use std::io::Write;
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(stamped.as_bytes());
    }
}
