//! The local print bridge: polls the server's print-job queue and drives LAN
//! thermal printers directly, independent of whatever page the webview
//! happens to be showing.
//!
//! Server side (already built, see `supabase/migrations/0027_kot_printing.sql`,
//! `0150_kot_bridge_retry.sql`, `0151_kot_update_versioning.sql`) enqueues
//! print jobs on a queue and exposes exactly two HTTP routes for this side to
//! call: `POST /api/print/poll` to claim a batch of jobs, `POST
//! /api/print/report` to say how each one went. Everything below exists to
//! close that loop — nobody had written the actual consumer before this, which
//! is why KOT printing only ever worked while a browser tab stayed open on the
//! Kitchen page.
//!
//! Handles LAN printers (direct TCP) and USB printers (via the Windows print
//! spooler, see `winspool.rs`) — see `target_for()` below for the exact
//! routing. A job routed to a bluetooth printer is left alone rather than
//! attempted or failed — that printer keeps working through the existing
//! browser/Kitchen-page path, untouched by any of this.

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use tauri::Manager;

use crate::escpos::{Ticket, TicketItem, TicketUpdate};
use crate::printing::{self, Target};

const POLL_URL: &str = "https://khaopiyo.ventron.in/api/print/poll";
const REPORT_URL: &str = "https://khaopiyo.ventron.in/api/print/report";
const POLL_INTERVAL: Duration = Duration::from_secs(4);

// ── Pairing token storage ───────────────────────────────────────────────────
//
// Deliberately a separate file from session.rs's session.json. That one holds
// whichever staff member is currently signed in and is wiped on sign-out; this
// one holds which café/printer setup this PC is paired to, and must survive
// sign-out — a shift change should never silently un-pair the kitchen printer.

fn bridge_token_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("no data directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir.join("bridge.json"))
}

/// A plain-text log the bridge writes its own key lifecycle events to —
/// startup, its first successful poll, and any error. The mechanics moved to
/// `applog.rs` when the updater needed the same thing (see that module for
/// why it's shared rather than copied); this stays as the bridge's own name
/// for its own file, so every call site below reads exactly as it did.
fn log_line(app: &tauri::AppHandle, line: &str) {
    crate::applog::log_line(app, "bridge.log", line);
}

/// Called once, when an owner/manager pairs this PC from the web UI's printer
/// settings page (that UI is out of scope here — this command is its target).
#[tauri::command]
pub fn save_bridge_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    let path = bridge_token_path(&app)?;
    fs::write(&path, token.trim()).map_err(|e| format!("could not write {}: {e}", path.display()))
}

/// None means "not paired yet" — the bridge loop's normal resting state on a
/// fresh install, not a failure.
#[tauri::command]
pub fn load_bridge_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = bridge_token_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let trimmed = raw.trim();
    Ok(if trimmed.is_empty() { None } else { Some(trimmed.to_string()) })
}

/// Un-pairing is explicit and separate from signing out, on purpose.
#[tauri::command]
pub fn clear_bridge_token(app: tauri::AppHandle) -> Result<(), String> {
    let path = bridge_token_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("could not delete {}: {e}", path.display()))?;
    }
    Ok(())
}

// ── Wire shapes for /api/print/poll ─────────────────────────────────────────
//
// Deliberately NOT `serde_json::from_value::<Ticket>(document)` — Ticket's
// `paper_mm`/`time_label` don't exist under those names in the raw document
// (which has `paper_width: "58mm"|"80mm"` and separate `placed_at`+`timezone`
// fields), and both are `#[serde(default)]` on Ticket, so a naive deserialize
// would silently succeed with the wrong paper width and a blank time instead
// of erroring. These Raw* structs mirror the actual payload shape from
// `build_kot_payload`/`build_kot_update_payload`, and `build_ticket`/
// `build_ticket_update` below do the mapping explicitly.

#[derive(serde::Deserialize)]
struct PollResponse {
    #[serde(default)]
    jobs: Vec<Job>,
}

#[derive(serde::Deserialize)]
struct Job {
    job_id: String,
    kind: String,
    printer: PrinterInfo,
    document: serde_json::Value,
}

#[derive(serde::Deserialize)]
struct PrinterInfo {
    #[serde(default)]
    name: String,
    connection_type: String,
    #[serde(default)]
    ip_address: Option<String>,
    #[serde(default)]
    port: Option<u16>,
}

/// Raw `document` shape for kind in (kot, reprint, test) — see
/// `build_kot_payload` in 0027_kot_printing.sql.
#[derive(serde::Deserialize, Default)]
struct RawTicket {
    kot_number: String,
    #[serde(default)]
    cafe_name: Option<String>,
    #[serde(default)]
    table_label: Option<String>,
    #[serde(default)]
    order_type: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    placed_at: Option<String>,
    #[serde(default)]
    timezone: Option<String>,
    #[serde(default)]
    station: Option<String>,
    #[serde(default)]
    paper_width: Option<String>,
    #[serde(default)]
    copies: Option<u32>,
    #[serde(default)]
    items: Vec<TicketItem>,
    #[serde(default)]
    order_note: Option<String>,
}

/// Raw `document` shape for kind = kot_update — see
/// `build_kot_update_payload` in 0151_kot_update_versioning.sql.
#[derive(serde::Deserialize, Default)]
struct RawTicketUpdate {
    kot_number: String,
    #[serde(default)]
    cafe_name: Option<String>,
    #[serde(default)]
    table_label: Option<String>,
    #[serde(default)]
    order_type: Option<String>,
    #[serde(default)]
    placed_at: Option<String>,
    #[serde(default)]
    timezone: Option<String>,
    #[serde(default)]
    station: Option<String>,
    #[serde(default)]
    paper_width: Option<String>,
    #[serde(default)]
    copies: Option<u32>,
    #[serde(default)]
    added: Vec<TicketItem>,
    #[serde(default)]
    removed: Vec<TicketItem>,
    #[serde(default)]
    order_note: Option<String>,
}

/// "58mm" / "80mm" → 58 / 80. Anything else — missing field, unexpected
/// string — is left as `None` so `render()`'s own default (58, the narrower
/// and therefore safer of the two) applies rather than this guessing.
fn map_paper_mm(paper_width: Option<&str>) -> Option<u32> {
    match paper_width {
        Some("58mm") => Some(58),
        Some("80mm") => Some(80),
        _ => None,
    }
}

/// `placed_at` (RFC 3339, always UTC from Postgres) rendered into the café's
/// own IANA timezone as a short header string. Never propagates an error: a
/// bad timestamp means a blank time label, an unrecognised zone means a UTC
/// fallback, and either way the job still prints rather than getting dropped.
fn format_time_label(placed_at: &str, timezone: &str) -> Option<String> {
    let dt = chrono::DateTime::parse_from_rfc3339(placed_at).ok()?;
    let formatted = match timezone.parse::<chrono_tz::Tz>() {
        Ok(tz) => dt.with_timezone(&tz).format("%d %b, %H:%M").to_string(),
        Err(_) => dt.with_timezone(&chrono::Utc).format("%d %b, %H:%M").to_string(),
    };
    Some(formatted.to_uppercase())
}

/// "NEW ORDER" for a fresh auto-printed ticket, "REPRINT" for one queued via
/// the Reprint KOT button (`print_jobs.kind = 'reprint'`, see `reprint_kot`
/// in 0027_kot_printing.sql) — `None` for a test ticket, which is already
/// self-explanatory from its own kot_number/order_note. Printed as its own
/// line so a reprint, which auto-printing can legitimately produce alongside
/// the original, can never be mistaken for a second unrelated order.
fn status_for_kind(kind: &str) -> Option<String> {
    match kind {
        "kot" => Some("NEW ORDER".to_string()),
        "reprint" => Some("REPRINT".to_string()),
        _ => None,
    }
}

fn build_ticket(doc: RawTicket, kind: &str) -> Ticket {
    let time_label = doc
        .placed_at
        .as_deref()
        .and_then(|p| format_time_label(p, doc.timezone.as_deref().unwrap_or("UTC")));
    Ticket {
        kot_number: doc.kot_number,
        table_label: doc.table_label,
        order_type: doc.order_type,
        time_label,
        station: doc.station,
        items: doc.items,
        order_note: doc.order_note,
        paper_mm: map_paper_mm(doc.paper_width.as_deref()),
        copies: doc.copies,
        source: doc.source,
        cafe_name: doc.cafe_name,
        status: status_for_kind(kind),
    }
}

fn build_ticket_update(doc: RawTicketUpdate) -> TicketUpdate {
    let time_label = doc
        .placed_at
        .as_deref()
        .and_then(|p| format_time_label(p, doc.timezone.as_deref().unwrap_or("UTC")));
    TicketUpdate {
        kot_number: doc.kot_number,
        table_label: doc.table_label,
        order_type: doc.order_type,
        time_label,
        station: doc.station,
        added: doc.added,
        removed: doc.removed,
        order_note: doc.order_note,
        paper_mm: map_paper_mm(doc.paper_width.as_deref()),
        copies: doc.copies,
        cafe_name: doc.cafe_name,
    }
}

/// `None` means "this bridge has no way to reach it" — the signal to skip
/// the job entirely rather than attempt or fail it.
fn target_for(printer: &PrinterInfo) -> Option<Target> {
    match printer.connection_type.as_str() {
        "lan" => Some(Target::Tcp {
            host: printer.ip_address.clone().unwrap_or_default(),
            port: printer.port,
        }),
        // A usb-configured printer means the machine running this bridge
        // has it physically attached — reach it via whichever printer
        // Windows currently treats as default, the same path the manual
        // "Print now on this device" fallback already proved works for it.
        // Bluetooth stays unhandled here: it has no reliable, driver-free
        // Windows equivalent to fall back on the way USB does.
        "usb" => Some(Target::Windows),
        _ => None,
    }
}

async fn report(client: &reqwest::Client, token: &str, job_id: &str, ok: bool, error: Option<&str>) {
    let body = serde_json::json!({
        "token": token,
        "job_id": job_id,
        "ok": ok,
        "error": error,
    });
    // Best-effort: if this itself fails to reach the server, the job stays
    // claimed as "printing" and the server's own retry/backoff (migration
    // 0150) eventually reclaims it. Nothing here should escalate that into a
    // crashed loop.
    if let Err(e) = client.post(REPORT_URL).json(&body).send().await {
        eprintln!("[bridge] could not report job {job_id}: {e}");
    }
}

async fn process_job(client: &reqwest::Client, token: &str, job: Job) {
    let target = match target_for(&job.printer) {
        Some(t) => t,
        None => {
            eprintln!(
                "[bridge] skipping job {} — printer \"{}\" is {} (bridge only handles lan)",
                job.job_id, job.printer.name, job.printer.connection_type
            );
            return;
        }
    };

    let result = match job.kind.as_str() {
        "kot_update" => match serde_json::from_value::<RawTicketUpdate>(job.document) {
            Ok(raw) => printing::dispatch_update(target, &build_ticket_update(raw)),
            Err(e) => Err(format!("malformed kot_update payload: {e}")),
        },
        // kot | reprint | test all share the same document shape.
        kind => match serde_json::from_value::<RawTicket>(job.document) {
            Ok(raw) => printing::dispatch(target, &build_ticket(raw, kind)),
            Err(e) => Err(format!("malformed {kind} payload: {e}")),
        },
    };

    match result {
        Ok(()) => report(client, token, &job.job_id, true, None).await,
        Err(e) => {
            eprintln!("[bridge] job {} failed: {e}", job.job_id);
            report(client, token, &job.job_id, false, Some(&e)).await;
        }
    }
}

/// The actual bug behind a day's worth of "the bridge silently isn't
/// working": this used to deserialize the response body straight into
/// `PollResponse` with no status check at all. `PollResponse.jobs` is
/// `#[serde(default)]` (needed so a genuine `{"jobs": [...]}` body with no
/// error field parses fine) — but that same leniency means the *error* body
/// `{"error": "invalid bridge token"}` the API sends back on a 401 also
/// parses without a hitch, into an empty `jobs: []`. A revoked or malformed
/// token therefore looked identical to "polled fine, nothing to print",
/// forever, with no error ever logged — this is what the bridge.log tracing
/// added for the runtime-hang investigation actually caught: successful-
/// looking polls with a token the server had already revoked. Checking the
/// status first is the one-line fix that whole investigation was missing.
async fn poll_once(client: &reqwest::Client, token: &str) -> Result<Vec<Job>, String> {
    let resp = client
        .post(POLL_URL)
        .json(&serde_json::json!({ "token": token, "limit": 10 }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {body}"));
    }
    let body: PollResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(body.jobs)
}

/// Runs for the life of the process, started once from `main.rs`'s `.setup()`
/// and never gated on which page the webview is showing. Every failure mode —
/// not paired yet, a network blip, a malformed job, a printer that's offline —
/// is swallowed and logged rather than propagated: the only thing worse than
/// one print job silently not printing is this loop dying and nothing ever
/// printing again until someone notices the app needs a restart.
pub async fn run(app: tauri::AppHandle) {
    log_line(&app, "bridge thread started, entering poll loop");

    // Every step of the client build and the first few loop ticks is logged
    // individually below, deliberately more verbose than this file would
    // normally be. Found live: both the dedicated-thread version (v1.1.4/
    // v1.1.5) AND the original tauri::async_runtime::spawn version (v1.1.6,
    // reverting back to what v1.1.2/1.1.3 shipped) exhibit the identical
    // symptom — "bridge thread started" logs, then nothing else, ever, no
    // success and no error, across five separate launches on the same
    // machine with confirmed-working network. That rules out the runtime/
    // threading model as the cause, which was the working theory behind the
    // v1.1.4 change and the v1.1.6 revert — something else, introduced
    // alongside this logging in v1.1.4 and never removed, is the real
    // suspect. This granular tick-by-tick trace exists to find out which
    // single line it actually stalls on, instead of guessing a fourth time.
    let client = match reqwest::Client::builder().timeout(Duration::from_secs(10)).build() {
        Ok(c) => c,
        Err(e) => {
            log_line(&app, &format!("could not build HTTP client, bridge disabled: {e}"));
            return;
        }
    };
    log_line(&app, "http client built");

    // Tracks whether this process has ever completed a poll — logged once,
    // the first time it flips, as the clearest possible answer to "did the
    // bridge actually come up this launch, and how long did it take."
    let mut polled_yet = false;
    let mut tick: u32 = 0;

    loop {
        tick += 1;
        let verbose = tick <= 5;

        if verbose {
            log_line(&app, &format!("tick {tick}: loading bridge token"));
        }
        let token = match load_bridge_token(app.clone()) {
            Ok(Some(t)) if !t.is_empty() => Some(t),
            Ok(_) => None,
            Err(e) => {
                if verbose {
                    log_line(&app, &format!("tick {tick}: load_bridge_token error: {e}"));
                }
                None
            }
        };
        if verbose {
            log_line(&app, &format!("tick {tick}: token present = {}", token.is_some()));
        }

        if let Some(token) = token {
            if verbose {
                log_line(&app, &format!("tick {tick}: calling poll_once"));
            }
            match poll_once(&client, &token).await {
                Ok(jobs) => {
                    if !polled_yet {
                        polled_yet = true;
                        log_line(&app, &format!("first poll succeeded ({} jobs)", jobs.len()));
                    } else if verbose {
                        log_line(&app, &format!("tick {tick}: poll succeeded ({} jobs)", jobs.len()));
                    }
                    for job in jobs {
                        process_job(&client, &token, job).await;
                    }
                }
                Err(e) => {
                    log_line(&app, &format!("tick {tick}: poll failed: {e}"));
                }
            }
        }

        if verbose {
            log_line(&app, &format!("tick {tick}: sleeping {POLL_INTERVAL:?}"));
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_paper_width_strings_to_millimetres() {
        assert_eq!(map_paper_mm(Some("58mm")), Some(58));
        assert_eq!(map_paper_mm(Some("80mm")), Some(80));
        assert_eq!(map_paper_mm(None), None);
        assert_eq!(map_paper_mm(Some("junk")), None);
    }

    #[test]
    fn formats_a_utc_timestamp_in_the_cafes_timezone() {
        // 2026-08-20T14:12:00Z is 19:42 IST (UTC+5:30).
        let label = format_time_label("2026-08-20T14:12:00Z", "Asia/Kolkata").unwrap();
        assert!(label.contains("19:42"), "expected 19:42 IST, got {label:?}");
        assert!(label.contains("20 AUG"), "expected 20 AUG, got {label:?}");
    }

    #[test]
    fn falls_back_to_utc_rather_than_failing_on_an_unknown_timezone() {
        let label = format_time_label("2026-08-20T14:12:00Z", "Not/AZone").unwrap();
        assert!(label.contains("14:12"), "expected UTC fallback 14:12, got {label:?}");
    }

    #[test]
    fn returns_none_rather_than_panicking_on_an_unparseable_timestamp() {
        assert_eq!(format_time_label("not-a-timestamp", "Asia/Kolkata"), None);
    }

    #[test]
    fn maps_the_raw_kot_document_into_a_ticket_explicitly() {
        let raw = RawTicket {
            kot_number: "42".into(),
            paper_width: Some("80mm".into()),
            placed_at: Some("2026-08-20T14:12:00Z".into()),
            timezone: Some("Asia/Kolkata".into()),
            items: vec![TicketItem { qty: 1, name: "Tea".into(), modifiers: vec![], note: None }],
            ..Default::default()
        };
        let ticket = build_ticket(raw, "kot");
        assert_eq!(ticket.paper_mm, Some(80));
        assert!(ticket.time_label.unwrap().contains("19:42"));
        assert_eq!(ticket.items.len(), 1);
        assert_eq!(ticket.status.as_deref(), Some("NEW ORDER"));
    }

    #[test]
    fn marks_a_reprint_distinctly_from_a_new_order() {
        let raw = RawTicket { kot_number: "42".into(), ..Default::default() };
        assert_eq!(build_ticket(raw, "reprint").status.as_deref(), Some("REPRINT"));
        let raw2 = RawTicket { kot_number: "42".into(), ..Default::default() };
        assert_eq!(build_ticket(raw2, "test").status, None);
    }

    #[test]
    fn maps_the_raw_kot_update_document_into_a_ticket_update_explicitly() {
        let raw = RawTicketUpdate {
            kot_number: "42".into(),
            paper_width: Some("58mm".into()),
            added: vec![TicketItem { qty: 1, name: "Cold Coffee".into(), modifiers: vec![], note: None }],
            removed: vec![TicketItem { qty: 1, name: "Burger".into(), modifiers: vec![], note: None }],
            ..Default::default()
        };
        let update = build_ticket_update(raw);
        assert_eq!(update.paper_mm, Some(58));
        assert_eq!(update.added.len(), 1);
        assert_eq!(update.removed.len(), 1);
    }

    #[test]
    fn targets_lan_printers_over_tcp() {
        let lan = PrinterInfo {
            name: "Kitchen".into(),
            connection_type: "lan".into(),
            ip_address: Some("192.168.1.50".into()),
            port: None,
        };
        assert!(matches!(target_for(&lan), Some(Target::Tcp { .. })));
    }

    #[test]
    fn targets_usb_printers_via_the_windows_default_printer() {
        let usb = PrinterInfo {
            name: "Counter".into(),
            connection_type: "usb".into(),
            ip_address: None,
            port: None,
        };
        assert!(matches!(target_for(&usb), Some(Target::Windows)));
    }

    #[test]
    fn leaves_bluetooth_printers_unhandled() {
        let bt = PrinterInfo {
            name: "Handheld".into(),
            connection_type: "bluetooth".into(),
            ip_address: None,
            port: None,
        };
        assert!(target_for(&bt).is_none());
    }
}
