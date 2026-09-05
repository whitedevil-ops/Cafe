#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod applog;
mod bridge;
mod escpos;
mod printing;
mod session;
mod winspool;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

/// Check for a new version once, shortly after launch, and install it
/// silently — no confirmation prompt, nothing to click, ever. A café till
/// left unattended for hours must never sit there waiting on a "Yes"
/// nobody's around to press.
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
///
/// The one visible trace of any of this is a native toast shown right
/// *before* installing — informational only, never a prompt (nothing waits
/// on it), and its own failure is swallowed too: a notification that didn't
/// show is not a reason to have skipped the update it was announcing.
///
/// Swallowed is not the same as invisible, though, and until now this was
/// both: every branch below ended in a bare `return` or a `let _ =`, so an
/// updater that never initialised, a check that errored, and a download that
/// failed all looked identical from the outside to a till that was simply
/// already current. That is exactly the shape of the bug that hid a broken
/// print bridge for a full day, and it is why a till observed sitting on the
/// old version for over a minute could not be diagnosed at all. Every branch
/// now writes one line to `updater.log`. Nothing else changes: no prompt, no
/// retry, no different timing, and still nothing that can stop the till
/// opening.
fn spawn_update_check(app: &tauri::AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        applog::log_line(&handle, UPDATE_LOG, "update check started");
        let updater = match handle.updater() {
            Ok(u) => u,
            Err(e) => {
                applog::log_line(&handle, UPDATE_LOG, &format!("updater unavailable: {e}"));
                return;
            }
        };
        // check() resolves to None when already current, which is the common
        // path and not an error. Logged all the same: "checked, nothing to
        // do" and "the check never happened" are the two possibilities a
        // stalled-on-an-old-version report has to tell apart, and only a line
        // in the log can do that.
        let update = match updater.check().await {
            Ok(Some(u)) => u,
            Ok(None) => {
                applog::log_line(&handle, UPDATE_LOG, "already up to date");
                return;
            }
            Err(e) => {
                applog::log_line(&handle, UPDATE_LOG, &format!("update check failed: {e}"));
                return;
            }
        };
        // Written before the install rather than after, for the same reason
        // the toast is: on Windows this process does not survive to write
        // anything afterwards. A log that ends here means the download or
        // install is where it got stuck.
        applog::log_line(&handle, UPDATE_LOG, &format!("update found: version {}", update.version));
        // Shown BEFORE installing, not after: on Windows the process
        // exits as part of running the installer (a documented Tauri
        // limitation, not a bug here), so a toast queued for "once
        // installed" could easily never get a chance to render before
        // the app is already gone.
        let _ = handle
            .notification()
            .builder()
            .title("KhaoPiyo is updating")
            .body(format!("Installing version {} — the app will restart in a moment.", update.version))
            .show();
        if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
            applog::log_line(&handle, UPDATE_LOG, &format!("download/install failed: {e}"));
        }
    });
}

/// Its own file, not the bridge's — see `applog.rs` for why.
const UPDATE_LOG: &str = "updater.log";

/// Also its own file, for the reason `applog.rs` gives: a log answers one
/// question, and this one answers "is the app going to be there when the café
/// needs it?" — both halves of that, registering with Windows startup and the
/// tray icon that is now the only way back to a hidden window. Neither belongs
/// in `updater.log` ("why is it on the old version") or `bridge.log` ("why
/// isn't it printing"), and the bridge's every-few-seconds chatter would trip
/// the size cap and wipe the one line that explained a till that never came
/// back after a reboot.
const STARTUP_LOG: &str = "startup.log";

/// Dropped next to the logs once the one-time autostart decision below has
/// actually been settled. Its existence is the entire signal; nothing ever
/// reads its contents.
const AUTOSTART_MARKER: &str = "autostart-configured";

/// Menu item ids for the tray. Ids, not labels — the label is what staff read
/// and is free to be reworded or translated, while these are what the event
/// handler matches on, and the two drifting apart is a menu that silently
/// stops doing anything.
const MENU_OPEN: &str = "open";
const MENU_QUIT: &str = "quit";

/// How long to keep the webview alive after a quit has been asked for, before
/// the process actually goes.
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
///
/// This used to hang off the window's close handler, because closing the
/// window was how the app exited. It is not any more — closing now only hides,
/// and the webview goes on living for hours afterwards with all the time in
/// the world to flush, so that path needs no grace period whatsoever. What has
/// not changed is that *something* still eventually ends the process, and
/// ending it half a second after someone logged in still throws the login
/// away. So the grace did not become unnecessary, it moved: to the one action
/// that now deliberately ends the process, the tray's Quit.
const FLUSH_GRACE: std::time::Duration = std::time::Duration::from_millis(1200);

/// Put the main window back in front of whoever asked for it: unhidden,
/// unminimised, and focused.
///
/// One copy, three callers — a second launch of an already-running app, the
/// tray menu's "Open KhaoPiyo", and a left click on the tray icon. All three
/// mean precisely the same thing to a member of staff ("put the till back on
/// the screen"), and all three now routinely arrive at a window that is hidden
/// *and* minimised *and* behind something else, because closing the window no
/// longer closes the app. Three separate near-copies of this is three chances
/// for one of them to forget a call and read, to the café, as a menu item that
/// does nothing.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// End the app for real. The only path that does.
///
/// Hides first and exits a moment later rather than exiting outright, so that
/// quitting still *looks* instant while the webview finishes writing what it
/// owes to disk — see `FLUSH_GRACE`.
fn quit_app(app: &tauri::AppHandle) {
    // Two things at once. It stops a second click on Quit (or a click while
    // the first is still waiting out the flush) from starting a second timer,
    // and — the part that actually matters — it is what tells the close
    // handler to stand aside, because the exit below asks the window to close
    // and would otherwise be refused by the very handler that keeps the app
    // alive.
    if app.state::<Quitting>().0.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FLUSH_GRACE);
        handle.exit(0);
    });
}

/// Register the app to start when Windows starts — once, and then never
/// argue about it again.
///
/// The symptom: a till PC reboots (a power cut, an overnight Windows update,
/// staff switching it off at closing time) and nothing brings KhaoPiyo back.
/// The missing window is the half people notice. The expensive half is
/// invisible, because the print bridge lives in this process: kitchen tickets
/// simply stop, with no error, no warning and nothing on screen to look at,
/// until somebody eventually remembers the app has to be opened by hand. That
/// is not hypothetical — it is a full day of a real café's tickets not
/// printing.
///
/// The plugin is registered here, inside setup, rather than in the builder
/// chain with its siblings. `autolaunch()` reaches for plugin-managed state
/// and *panics* if that state has not been installed yet, and a panic here is
/// a till that will not open at all — a far worse failure than the one this
/// function exists to prevent. `AppHandle::plugin` initialises the plugin
/// synchronously, so registering it on the line above its first use is the one
/// ordering that stays correct no matter when Tauri chooses to run setup
/// hooks. It is also exactly what the plugin's own documentation does.
///
/// Enabled once and then left alone, rather than re-asserted every launch, and
/// the marker file is what makes that possible. Checking `is_enabled()` is not
/// on its own enough to avoid fighting the user: turning KhaoPiyo off in
/// Windows Settings → Startup Apps (or Task Manager) does not delete the Run
/// entry this wrote, it flips a separate "StartupApproved" flag — and
/// `is_enabled()` reads that flag too and answers *false*. So an app that
/// enables whenever it sees `false` would switch itself back on the morning
/// after every deliberate switch-off, silently, forever. That is how an app
/// earns an uninstall, and an uninstalled app prints nothing at all. Once the
/// marker is down, the Windows startup setting belongs to whoever is sitting
/// at the machine.
///
/// The marker is written only after the decision genuinely succeeded, so a
/// first run that could not reach the registry retries on the next launch
/// instead of giving up forever on the strength of one bad morning.
///
/// Every outcome gets a line, for the same reason the updater's do: a till
/// that failed to come back after a reboot and a till that was never
/// registered in the first place look identical from the outside, and only a
/// file on disk can tell them apart afterwards.
fn setup_autostart(app: &tauri::AppHandle) {
    // LaunchAgent is the macOS half of the plugin's signature and is inert on
    // Windows, which is the only platform this app actually ships to — the
    // release workflow builds nothing else. No launch arguments either: the
    // app takes none, and anything passed here gets baked into the registry
    // value where it would outlive every memory of why it was added.
    if let Err(e) = app.plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None)) {
        applog::log_line(app, STARTUP_LOG, &format!("autostart plugin failed to register: {e}"));
        return;
    }

    let marker = match app.path().app_local_data_dir() {
        Ok(dir) => {
            // On a genuinely first run this directory does not exist yet, and
            // a marker that cannot be written is a decision that gets made
            // again every single launch.
            let _ = std::fs::create_dir_all(&dir);
            dir.join(AUTOSTART_MARKER)
        }
        Err(e) => {
            applog::log_line(app, STARTUP_LOG, &format!("autostart skipped, no data dir: {e}"));
            return;
        }
    };
    if marker.exists() {
        applog::log_line(app, STARTUP_LOG, "autostart already decided once — leaving the Windows startup setting alone");
        return;
    }

    let manager = app.autolaunch();
    let outcome = match manager.is_enabled() {
        Ok(true) => "autostart already enabled",
        Ok(false) => match manager.enable() {
            Ok(()) => "autostart enabled",
            Err(e) => {
                applog::log_line(app, STARTUP_LOG, &format!("autostart enable failed: {e}"));
                return;
            }
        },
        Err(e) => {
            applog::log_line(app, STARTUP_LOG, &format!("autostart state unreadable: {e}"));
            return;
        }
    };
    applog::log_line(app, STARTUP_LOG, outcome);
    // Best effort: a marker that could not be written costs one redundant
    // registry read on the next launch and nothing else.
    let _ = std::fs::write(&marker, "");
}

/// The tray icon — and the reason closing the window is now survivable.
///
/// Before this, the X button ended the process, which ended the print bridge
/// with it. Staff close windows for entirely ordinary reasons (getting the
/// till off the screen to look at something else), nobody on earth expects
/// closing a window to stop a kitchen printer, and there was nothing on screen
/// afterwards to suggest anything had gone wrong. The tray is what gives the
/// window somewhere to go instead of away: the process keeps running, tickets
/// keep printing, and this icon is how anyone gets the window back or ends the
/// app on purpose.
///
/// Errors are returned rather than swallowed so the caller can log them, but
/// see the call site: a tray that failed to appear is not allowed to stop the
/// till opening.
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, MENU_OPEN, "Open KhaoPiyo", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let mut builder: TrayIconBuilder<tauri::Wry> = TrayIconBuilder::with_id("khaopiyo");
    // The icon already bundled with the app, not a second copy of it: one file
    // to change if the branding ever does. Missing is survivable rather than
    // fatal — a blank tray icon is still a way back to the window and still a
    // way to quit, and no tray at all is neither.
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        // Answers the only question anyone hovering this has, which is what on
        // earth the app is still doing when its window is nowhere to be seen.
        .tooltip("KhaoPiyo — running, still printing kitchen tickets")
        .menu(&menu)
        // Left click belongs to "give me the till back", the one thing anybody
        // ever wants from this icon. Tauri's default pops the menu on left
        // click too, which would put a two-item menu between a member of staff
        // and their screen every time. The menu is still one right click away.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_OPEN => show_main_window(app),
            MENU_QUIT => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // The release half of a left click only. The event fires once on
            // press and again on release, and treating both as a request
            // would raise and re-raise the window for a single click.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

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
        //
        // That second launch is a much more common event than it used to be:
        // with the window closing to the tray, "open KhaoPiyo again" is what
        // staff will naturally do to get a hidden window back, and it lands
        // here rather than starting anything.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            printing::list_serial_ports,
            printing::print_ticket,
            session::save_session,
            session::load_session,
            session::clear_session,
            bridge::save_bridge_token,
            bridge::load_bridge_token,
            bridge::clear_bridge_token,
        ])
        .setup(|app| {
            spawn_update_check(app.handle());
            setup_autostart(app.handle());
            // Logged, never propagated. A tray that failed to build is worth
            // knowing about, but returning the error here would refuse to open
            // the till over a decoration — and the fallback is survivable:
            // the window still works, and launching the app again still raises
            // it through the single-instance handler above, so a missing tray
            // is an annoyance rather than a hidden window with no way back.
            if let Err(e) = setup_tray(app.handle()) {
                applog::log_line(app.handle(), STARTUP_LOG, &format!("tray icon failed to build: {e}"));
            }
            // Independent of the webview entirely: starts once at launch and
            // runs for the life of the process, whether the Kitchen page is
            // open, some other page is showing, or the window is hidden.
            //
            // "The life of the process" is a materially longer thing than it
            // was: the window closing no longer ends it, which is the whole
            // point — a café that closed the window to get it off the screen
            // used to stop printing at that exact moment and had no way to
            // know.
            //
            // v1.1.4 briefly moved this onto its own dedicated OS thread with
            // its own bare tokio::runtime::Builder, on the theory that
            // sharing Tauri's runtime with the update checker was losing a
            // startup scheduling race. Reverted: that "fix" made things
            // worse, not better — found live (bridge.rs's own bridge.log)
            // that the dedicated-runtime loop didn't just occasionally start
            // late, it hung completely, forever, with the network itself
            // confirmed fine (a manual request to the same endpoint from the
            // same machine succeeded in under 2 seconds while the bridge
            // thread sat silent for minutes). Something about a bare
            // current-thread runtime built on a plain std::thread — reqwest's
            // client, AppHandle access from a foreign runtime, or an
            // interaction between the two — deadlocks in a way Tauri's own
            // runtime does not. Back to the original, imperfect-but-actually-
            // working behavior until the real cause is understood; the
            // occasional need for a restart is a known, lesser evil than a
            // silent permanent hang.
            tauri::async_runtime::spawn(bridge::run(app.handle().clone()));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // The X button hides the window. It does not end the app.
                //
                // The print bridge lives in this process, so an app that
                // exited here took auto-printing with it — and the café had no
                // way to find that out, because closing a window is not a
                // thing anybody expects to stop the kitchen printer. Staff
                // close the window for perfectly ordinary reasons and the till
                // has to carry on printing regardless. The tray icon is where
                // the window goes, and the tray's Quit is the only way out.
                //
                // Note this deliberately does not latch. The previous version
                // *swapped* a flag to true here, so that the exit it started
                // could re-enter and be let through. Keeping that swap now
                // would be quietly disastrous: the first close of the day
                // would hide the window and set the flag, and the second close
                // would sail straight past this branch and shut the bridge
                // down — the exact silent failure this change exists to
                // remove, merely rescheduled to happen later in the day. The
                // flag is set in one place only, `quit_app`, and only read
                // here.
                if window.state::<Quitting>().0.load(std::sync::atomic::Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .manage(Quitting::default())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Set exactly once, by `quit_app`, when a real exit is under way.
///
/// It is not a "closing" flag any more, and the rename is the substance of the
/// change rather than tidying. Closing a window is now the ordinary, endlessly
/// repeatable, harmless thing that happens whenever someone hits the X;
/// quitting is the rare deliberate one, and only the second may be allowed
/// through the close handler. The flag exists at all because `AppHandle::exit`
/// asks the window to close, which lands right back in that handler — with
/// nothing to tell that close apart from a member of staff's, the handler
/// would prevent it and the app could never be quit.
#[derive(Default)]
struct Quitting(std::sync::atomic::AtomicBool);
