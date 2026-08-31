#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod escpos;
mod printing;
mod session;
mod winspool;

use tauri::Manager;
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

/// How long to keep the webview alive after the window is dismissed.
///
/// The staff-facing symptom this exists for: the admin had to log in every
/// single time the app opened. The session cookie was never reaching disk —
/// the whole of the webview profile's Network folder sat frozen at the moment
/// it was first created, nine days and many logins later, while the profile
/// was demonstrably being opened each launch.
///
/// Chromium's network service commits cookies on a background task rather than
/// synchronously, so a process that exits the instant its window closes takes
/// every pending write with it. Hiding the window first makes the app *look*
/// closed immediately while the webview is still alive to finish flushing.
const FLUSH_GRACE: std::time::Duration = std::time::Duration::from_millis(1200);

fn main() {
    tauri::Builder::default()
        // Must be registered first, per the plugin's contract.
        //
        // This is the actual cause of "the admin has to log in every time".
        // Nothing stopped a second copy of the app starting, and two processes
        // cannot both own the WebView2 profile — the loser never commits its
        // network state, so the session cookie was written to memory and
        // thrown away. The profile's Cookies file had not changed since the
        // day it was created, nine days and many logins later, while lockfile
        // was touched on every launch. Now a second launch raises and focuses
        // the window that already exists.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            printing::list_serial_ports,
            printing::print_ticket,
            printing::get_default_windows_printer,
            session::save_session,
            session::load_session,
            session::clear_session,
            bridge::save_bridge_token,
            bridge::load_bridge_token,
            bridge::clear_bridge_token,
        ])
        .setup(|app| {
            spawn_update_check(app.handle());
            // Independent of the webview entirely: starts once at launch and
            // runs for the life of the process, whether the Kitchen page is
            // open, some other page is showing, or the window is hidden.
            tauri::async_runtime::spawn(bridge::run(app.handle().clone()));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Only intercept the first close. Without this guard the exit
                // below re-enters here and the app never quits.
                if window.state::<Closing>().0.swap(true, std::sync::atomic::Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
                let handle = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(FLUSH_GRACE);
                    handle.exit(0);
                });
            }
        })
        .manage(Closing::default())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Default)]
struct Closing(std::sync::atomic::AtomicBool);
