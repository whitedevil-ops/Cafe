//! Raw ESC/POS printing straight to a named Windows print queue, via the
//! spooler's RAW datatype — the same technique commercial POS software uses
//! to print receipts through an ordinary Windows driver with no dialog.
//!
//! This exists specifically for printers that only ever show up as a Windows
//! print queue (this app's own USB thermal printers, which enumerate as a
//! USBPRINT-class device, not a virtual COM port) — `printing.rs`'s serial/
//! tcp transports can't reach one at all. Isolated in its own module because
//! it is the only unsafe FFI in this codebase; everything here is a thin,
//! carefully-checked wrapper, and nothing outside this file touches the
//! Win32 printing API directly.
//!
//! Signatures verified against the `windows` crate's own generated docs
//! (Win32::Graphics::Printing) rather than assumed from memory — this
//! machine's Application Control policy blocks compiling this crate
//! (os error 4551 on cargo's own build scripts), so nothing here could be
//! checked by actually building it before it ships.

use std::ffi::c_void;

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, GetDefaultPrinterW, OpenPrinterW,
    StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_HANDLE,
};

/// UTF-16, NUL-terminated — every wide-string Win32 printing call below needs one.
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Whatever printer Windows itself currently treats as default — the same
/// one "Set as default" in Windows Settings controls, and what Windows
/// already auto-picks when only one real printer is installed. Built for
/// exactly that: nothing to configure in KhaoPiyo, nothing to get wrong —
/// the café's one thermal printer becomes the default the moment it's
/// installed, and this just uses it.
pub fn default_printer_name() -> Result<String, String> {
    let mut size: u32 = 0;
    // The first call is expected to report failure — passing no buffer is
    // exactly how you ask the API "how big does the buffer need to be?",
    // and it writes that answer into `size` either way.
    unsafe {
        let _ = GetDefaultPrinterW(None, &mut size);
    }
    if size == 0 {
        return Err("Windows has no default printer set".to_string());
    }

    let mut buf: Vec<u16> = vec![0; size as usize];
    let ok = unsafe { GetDefaultPrinterW(Some(PWSTR(buf.as_mut_ptr())), &mut size) };
    if !ok.as_bool() {
        return Err("could not read the Windows default printer".to_string());
    }
    // size includes the NUL Windows wrote; String::from_utf16_lossy would
    // otherwise carry a trailing NUL character into the name.
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Ok(String::from_utf16_lossy(&buf[..end]))
}

/// Closes the printer handle on every exit path, including an early return —
/// Rust has no `finally`, and repeating `ClosePrinter` at each error branch
/// is exactly how that call gets missed on one of them.
struct PrinterGuard(PRINTER_HANDLE);
impl Drop for PrinterGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = ClosePrinter(self.0);
        }
    }
}

/// Sends already-rendered ESC/POS bytes to a named Windows print queue. The
/// RAW datatype tells the spooler to hand the bytes to the printer verbatim —
/// no GDI rendering, no driver reinterpreting anything, no dialog.
pub fn write_windows_printer(printer_name: &str, bytes: &[u8]) -> Result<(), String> {
    let name_w = wide(printer_name);
    let mut handle = PRINTER_HANDLE::default();
    unsafe {
        OpenPrinterW(PCWSTR(name_w.as_ptr()), &mut handle, None)
            .map_err(|e| format!("could not open printer \"{printer_name}\": {e}"))?;
    }
    let _guard = PrinterGuard(handle);

    // Kept alive for the whole call below — DOC_INFO_1W only borrows the
    // pointers, so the buffers themselves must outlive it.
    let mut doc_name = wide("KOT");
    let mut datatype = wide("RAW");
    let doc_info = DOC_INFO_1W {
        pDocName: PWSTR(doc_name.as_mut_ptr()),
        pOutputFile: PWSTR::default(),
        pDatatype: PWSTR(datatype.as_mut_ptr()),
    };

    // StartDocPrinterW returns a job ID on success, 0 on failure — the one
    // function here that isn't a BOOL/Result, per its own documented contract.
    let job = unsafe { StartDocPrinterW(handle, 1, &doc_info) };
    if job == 0 {
        return Err(format!("could not start a print job on \"{printer_name}\""));
    }

    if !unsafe { StartPagePrinter(handle) }.as_bool() {
        unsafe {
            let _ = EndDocPrinter(handle);
        }
        return Err(format!("could not start a page on \"{printer_name}\""));
    }

    let mut written: u32 = 0;
    let wrote = unsafe {
        WritePrinter(handle, bytes.as_ptr() as *const c_void, bytes.len() as u32, &mut written)
    };
    // Both cleanup calls run regardless of whether the write itself
    // succeeded — an EndPagePrinter/EndDocPrinter skipped after a failed
    // write leaves the job stuck in the spooler queue.
    unsafe {
        let _ = EndPagePrinter(handle);
        let _ = EndDocPrinter(handle);
    }

    if !wrote.as_bool() || written as usize != bytes.len() {
        return Err(format!(
            "only wrote {written} of {} bytes to \"{printer_name}\"",
            bytes.len()
        ));
    }
    Ok(())
}
