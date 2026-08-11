//! Keeping the café signed in, without relying on the webview.
//!
//! The desktop webview does not persist cookies. Not "flushes them late" —
//! it never opens the cookie database at all, while writing cache and local
//! storage to the same profile quite happily. Three attempts to make it
//! behave failed, so this stops depending on it: the Supabase session is
//! handed to Rust, written to a file the webview has no say over, and handed
//! back on the next launch.
//!
//! What is stored is a refresh token — enough to mint new sessions until it
//! is revoked. That is the same authority the browser's own cookie store
//! holds, so this is not a new exposure, but it is worth knowing it sits in a
//! plain file in the app's data directory. Anyone with the café PC and this
//! file is signed in as that café, exactly as they would be with the browser.
//! Signing out deletes it.

use std::fs;
use std::path::PathBuf;

use tauri::Manager;

fn session_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("no data directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir.join("session.json"))
}

/// Store the session. Called whenever Supabase signs in or refreshes, so the
/// stored token stays current rather than aging into a rejected one.
#[tauri::command]
pub fn save_session(app: tauri::AppHandle, value: String) -> Result<(), String> {
    let path = session_path(&app)?;
    fs::write(&path, value).map_err(|e| format!("could not write {}: {e}", path.display()))
}

/// Returns None rather than an error when there is nothing stored — a first
/// run is the normal case, not a failure.
#[tauri::command]
pub fn load_session(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = session_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("could not read {}: {e}", path.display()))
}

/// Signing out has to remove it, or the next launch would silently sign the
/// café back in as whoever just left.
#[tauri::command]
pub fn clear_session(app: tauri::AppHandle) -> Result<(), String> {
    let path = session_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("could not delete {}: {e}", path.display()))?;
    }
    Ok(())
}
