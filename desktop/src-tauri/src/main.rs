#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_updater::UpdaterExt;

/// Check for a new version once, shortly after launch, and install it silently.
///
/// Deliberately done in Rust rather than from the page. The window loads a
/// remote URL (khaopiyo.ventron.in), and letting a remote origin drive the
/// updater would mean granting it Tauri APIs — a much larger door than this
/// needs. Nothing about updating depends on the page, so nothing about it is
/// exposed to the page.
///
/// Every failure is swallowed on purpose. A café with no internet, a GitHub
/// outage, or a malformed release must never stop the till from opening: the
/// app is a window onto a live site and works perfectly without ever updating
/// its shell. Worst case they keep the version they have.
fn spawn_update_check(app: &tauri::AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let updater = match handle.updater() {
            Ok(u) => u,
            Err(_) => return,
        };
        // check() resolves to None when already current, which is the common
        // path and not an error.
        if let Ok(Some(update)) = updater.check().await {
            let _ = update.download_and_install(|_, _| {}, || {}).await;
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            spawn_update_check(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
