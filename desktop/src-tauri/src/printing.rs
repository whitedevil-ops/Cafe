//! Where the ESC/POS bytes actually go.
//!
//! Three transports:
//!
//! * **Serial** — a Bluetooth printer paired in Windows appears as an outgoing
//!   COM port, and so does a printer built around a USB-to-serial chip. This
//!   is the path that matters for a printer with no Ethernet socket.
//! * **TCP** — port 9100, the raw-print port every network printer speaks.
//! * **Windows** — a printer that only ever shows up as an installed Windows
//!   print queue (USBPRINT-class USB, which is most cheap thermal printers
//!   sold in India — they never expose a COM port at all). Bytes go straight
//!   to the spooler's RAW datatype, same technique commercial POS software
//!   uses, so it's still no dialog and no GDI rendering even though a driver
//!   is involved in getting the queue registered in the first place. See
//!   winspool.rs for why this needs its own module.
//!
//! Serial and TCP need no Windows driver at all, which is the whole point of
//! having them: the browser path prints through a driver and cannot exist
//! without one, and cannot reach a network printer at all.

use std::io::Write;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde::Deserialize;

use crate::escpos::{self, Ticket, TicketUpdate};
use crate::winspool;

/// Most cheap Bluetooth thermal printers come up at 9600. A few use 115200,
/// hence the override rather than a constant.
const DEFAULT_BAUD: u32 = 9600;
const DEFAULT_TCP_PORT: u16 = 9100;
const TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Target {
    Serial {
        port: String,
        #[serde(default)]
        baud: Option<u32>,
    },
    Tcp {
        host: String,
        #[serde(default)]
        port: Option<u16>,
    },
    /// No printer name stored anywhere — resolved fresh against Windows'
    /// own default printer at write time, every time. If staff change the
    /// Windows default (a new printer, a replacement unit), this follows
    /// with zero config drift instead of quietly printing to a name that
    /// no longer exists.
    ///
    /// Deliberately a unit variant: internally-tagged serde only accepts a
    /// unit variant's JSON as the tag field alone (`{"kind":"windows"}`,
    /// nothing else). If this ever needs a field, it must become a
    /// struct-style variant like Serial/Tcp, or the TS side's plain
    /// `{ kind: 'windows' }` literal will start failing to deserialize.
    Windows,
}

fn write_serial(port: &str, baud: u32, bytes: &[u8]) -> Result<(), String> {
    let mut handle = serialport::new(port, baud)
        .timeout(TIMEOUT)
        .open()
        .map_err(|e| format!("could not open {port}: {e}"))?;
    handle
        .write_all(bytes)
        .map_err(|e| format!("could not write to {port}: {e}"))?;
    // Without this the port can close while bytes are still buffered, which
    // shows up as a ticket that stops mid-item.
    handle
        .flush()
        .map_err(|e| format!("could not flush {port}: {e}"))?;
    Ok(())
}

fn write_tcp(host: &str, port: u16, bytes: &[u8]) -> Result<(), String> {
    // connect_timeout needs a resolved address; without this a wrong IP hangs
    // for the OS default rather than the 5s above.
    let addr: SocketAddr = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("could not resolve {host}: {e}"))?
        .next()
        .ok_or_else(|| format!("no address for {host}"))?;
    let mut stream = TcpStream::connect_timeout(&addr, TIMEOUT)
        .map_err(|e| format!("could not reach {host}:{port}: {e}"))?;
    stream
        .set_write_timeout(Some(TIMEOUT))
        .map_err(|e| e.to_string())?;
    stream
        .write_all(bytes)
        .map_err(|e| format!("could not send to {host}:{port}: {e}"))?;
    stream.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Every COM port Windows knows about, so the café can pick theirs from a list
/// rather than being asked to type "COM3" correctly.
#[tauri::command]
pub fn list_serial_ports() -> Vec<String> {
    serialport::available_ports()
        .map(|ports| ports.into_iter().map(|p| p.port_name).collect())
        .unwrap_or_default()
}

/// Send already-rendered bytes to a target. The one place that knows how to
/// reach a printer at all — both `dispatch` and `dispatch_update` funnel
/// through here after rendering, so the manual `print_ticket` command and the
/// background bridge loop can never drift into two different write paths.
fn write_bytes(target: Target, bytes: &[u8]) -> Result<(), String> {
    match target {
        Target::Serial { port, baud } => write_serial(&port, baud.unwrap_or(DEFAULT_BAUD), bytes),
        Target::Tcp { host, port } => write_tcp(&host, port.unwrap_or(DEFAULT_TCP_PORT), bytes),
        Target::Windows => {
            let name = winspool::default_printer_name()?;
            winspool::write_windows_printer(&name, bytes)
        }
    }
}

/// Render a full ticket and send it. Plain function (not a Tauri command) so
/// it can be called both from the `print_ticket` IPC command below and from
/// the bridge's polling loop, which has no webview call to make it from.
pub fn dispatch(target: Target, ticket: &Ticket) -> Result<(), String> {
    write_bytes(target, &escpos::render(ticket))
}

/// Same as `dispatch`, for a change-KOT delta ticket.
pub fn dispatch_update(target: Target, ticket: &TicketUpdate) -> Result<(), String> {
    write_bytes(target, &escpos::render_update(ticket))
}

/// Render and send. Errors come back as plain strings for the page to show —
/// a cook needs "could not open COM3", not a stack trace.
#[tauri::command]
pub fn print_ticket(target: Target, ticket: Ticket) -> Result<(), String> {
    dispatch(target, &ticket)
}
