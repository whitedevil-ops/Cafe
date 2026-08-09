#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod escpos;
mod printing;

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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            printing::list_serial_ports,
            printing::print_ticket,
        ])
        .setup(|app| {
            spawn_update_check(app.handle());
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
