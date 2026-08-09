//! Kitchen ticket → ESC/POS bytes.
//!
//! The browser path prints an HTML page through a Windows driver. This one
//! talks to the printer directly, which is why it exists: no driver, no print
//! dialog, no browser window that has to stay open — and it can reach a network
//! printer, which a browser fundamentally cannot.
//!
//! ESC/POS is broadly standard across the cheap thermal printers sold in India
//! (TVS, Rugtek, Epson clones, the unbranded 58mm units). Only the cut command
//! and codepage handling really vary by vendor, so those are the two places to
//! look first if a specific printer misbehaves.
//!
//! Deliberately pure: bytes in, bytes out, no I/O. The transports in
//! `printing.rs` decide where they go, and the tests below can check the layout
//! without a printer attached.

use serde::Deserialize;

#[derive(Deserialize, Clone, Debug)]
pub struct TicketItem {
    pub qty: i32,
    pub name: String,
    #[serde(default)]
    pub modifiers: Vec<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Ticket {
    pub kot_number: String,
    #[serde(default)]
    pub table_label: Option<String>,
    #[serde(default)]
    pub order_type: Option<String>,
    /// Already formatted in the café's timezone by the caller — the printer
    /// has no idea what zone the café is in and this process must not guess.
    #[serde(default)]
    pub time_label: Option<String>,
    #[serde(default)]
    pub station: Option<String>,
    pub items: Vec<TicketItem>,
    #[serde(default)]
    pub order_note: Option<String>,
    /// 58 or 80. Anything else is treated as 58, the safer of the two: a
    /// ticket laid out narrow prints fine on wide paper, but not the reverse.
    #[serde(default)]
    pub paper_mm: Option<u32>,
    #[serde(default)]
    pub copies: Option<u32>,
}

const ESC: u8 = 0x1B;
const GS: u8 = 0x1D;
const LF: u8 = 0x0A;

/// Characters per line at the standard font. 58mm paper is 32, 80mm is 48.
fn columns(paper_mm: u32) -> usize {
    if paper_mm >= 80 { 48 } else { 32 }
}

/// These printers speak a single-byte codepage, not UTF-8. Rather than guess
/// which one a given unit booted with, restrict to ASCII and drop the rest —
/// a mangled item name in a hot kitchen is worse than a missing accent.
fn ascii(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '₹' => 'R',
            '—' | '–' => '-',
            '’' | '‘' => '\'',
            '“' | '”' => '"',
            c if c.is_ascii() => c,
            _ => '?',
        })
        .collect()
}

/// Wrap on word boundaries, breaking a word only when it cannot fit alone.
fn wrap(text: &str, width: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut line = String::new();
    for word in text.split_whitespace() {
        if word.len() > width {
            if !line.is_empty() {
                out.push(std::mem::take(&mut line));
            }
            for chunk in word.as_bytes().chunks(width) {
                out.push(String::from_utf8_lossy(chunk).to_string());
            }
            continue;
        }
        if line.is_empty() {
            line.push_str(word);
        } else if line.len() + 1 + word.len() <= width {
            line.push(' ');
            line.push_str(word);
        } else {
            out.push(std::mem::take(&mut line));
            line.push_str(word);
        }
    }
    if !line.is_empty() {
        out.push(line);
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

struct Builder {
    buf: Vec<u8>,
}

impl Builder {
    fn new() -> Self {
        let mut b = Builder { buf: Vec::new() };
        b.buf.extend_from_slice(&[ESC, b'@']); // initialise
        b
    }
    /// `GS ! n` — the high nibble is width, the low nibble height, each 0-based.
    fn size(&mut self, w: u8, h: u8) -> &mut Self {
        self.buf.extend_from_slice(&[GS, b'!', (w.min(7) << 4) | h.min(7)]);
        self
    }
    fn bold(&mut self, on: bool) -> &mut Self {
        self.buf.extend_from_slice(&[ESC, b'E', if on { 1 } else { 0 }]);
        self
    }
    fn align(&mut self, n: u8) -> &mut Self {
        self.buf.extend_from_slice(&[ESC, b'a', n]);
        self
    }
    fn text(&mut self, s: &str) -> &mut Self {
        self.buf.extend_from_slice(ascii(s).as_bytes());
        self
    }
    fn line(&mut self, s: &str) -> &mut Self {
        self.text(s);
        self.buf.push(LF);
        self
    }
    fn feed(&mut self, n: u8) -> &mut Self {
        self.buf.extend_from_slice(&[ESC, b'd', n]);
        self
    }
    /// `GS V 66 0` — partial cut after feeding the blade clear of the last
    /// line. Printers without a cutter ignore it, which is why it is always
    /// sent rather than made configurable.
    fn cut(&mut self) -> &mut Self {
        self.buf.extend_from_slice(&[GS, b'V', 66, 0]);
        self
    }
}

fn render_one(b: &mut Builder, t: &Ticket, cols: usize) {
    // Order number: the thing a cook finds from across the pass.
    b.align(1).size(1, 1).bold(true);
    b.line(&format!("#{}", t.kot_number));
    b.size(0, 0).bold(false);

    let takeaway = t.order_type.as_deref() == Some("takeaway");
    let where_ = if takeaway {
        "TAKEAWAY".to_string()
    } else {
        match t.table_label.as_deref() {
            Some(l) if !l.is_empty() => format!("Table {l}"),
            _ => "Dine-in".to_string(),
        }
    };
    let meta = match t.time_label.as_deref() {
        Some(time) if !time.is_empty() => format!("{where_}  {time}"),
        _ => where_,
    };
    b.line(&meta);
    if let Some(station) = t.station.as_deref().filter(|s| !s.is_empty()) {
        b.line(station);
    }

    b.align(0);
    b.line(&"-".repeat(cols));

    for item in &t.items {
        // Quantity and name double-height: legible at arm's length in bad
        // light, which is the only readability test that matters here.
        b.size(0, 1).bold(true);
        let head = format!("{} x {}", item.qty, item.name);
        // Double height does not halve the column count; double width would.
        for l in wrap(&head, cols) {
            b.line(&l);
        }
        b.size(0, 0).bold(false);

        let mods: Vec<&str> = item.modifiers.iter().map(|m| m.as_str()).filter(|m| !m.is_empty()).collect();
        if !mods.is_empty() {
            for l in wrap(&format!("+ {}", mods.join(", ")), cols.saturating_sub(2)) {
                b.line(&format!("  {l}"));
            }
        }
        if let Some(note) = item.note.as_deref().filter(|n| !n.is_empty()) {
            b.bold(true);
            for l in wrap(&note.to_uppercase(), cols.saturating_sub(2)) {
                b.line(&format!("  {l}"));
            }
            b.bold(false);
        }
        b.feed(1);
    }

    if let Some(note) = t.order_note.as_deref().filter(|n| !n.is_empty()) {
        b.line(&"-".repeat(cols));
        b.bold(true);
        for l in wrap(&format!("NOTE: {}", note.to_uppercase()), cols) {
            b.line(&l);
        }
        b.bold(false);
    }

    b.feed(3).cut();
}

pub fn render(t: &Ticket) -> Vec<u8> {
    let cols = columns(t.paper_mm.unwrap_or(58));
    let copies = t.copies.unwrap_or(1).clamp(1, 5);
    let mut b = Builder::new();
    for _ in 0..copies {
        render_one(&mut b, t, cols);
    }
    b.buf
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ticket() -> Ticket {
        Ticket {
            kot_number: "42".into(),
            table_label: Some("T08".into()),
            order_type: Some("dine_in".into()),
            time_label: Some("7:42 PM".into()),
            station: None,
            items: vec![TicketItem {
                qty: 2,
                name: "Veg Burger".into(),
                modifiers: vec!["Extra Cheese".into()],
                note: Some("no onion".into()),
            }],
            order_note: None,
            paper_mm: Some(58),
            copies: None,
        }
    }

    fn as_text(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).to_string()
    }

    #[test]
    fn starts_by_initialising_and_ends_by_cutting() {
        let out = render(&ticket());
        assert_eq!(&out[0..2], &[ESC, b'@']);
        assert_eq!(&out[out.len() - 4..], &[GS, b'V', 66, 0]);
    }

    #[test]
    fn carries_the_order_number_items_and_notes() {
        let text = as_text(&render(&ticket()));
        assert!(text.contains("#42"));
        assert!(text.contains("Table T08"));
        assert!(text.contains("7:42 PM"));
        assert!(text.contains("2 x Veg Burger"));
        assert!(text.contains("Extra Cheese"));
        assert!(text.contains("NO ONION"));
    }

    #[test]
    fn never_prints_money() {
        let text = as_text(&render(&ticket()));
        assert!(!text.contains('R') || !text.to_lowercase().contains("total"));
        assert!(!text.to_lowercase().contains("total"));
    }

    #[test]
    fn marks_takeaway_rather_than_inventing_a_table() {
        let mut t = ticket();
        t.order_type = Some("takeaway".into());
        t.table_label = None;
        let text = as_text(&render(&t));
        assert!(text.contains("TAKEAWAY"));
        assert!(!text.contains("Table"));
    }

    #[test]
    fn rules_span_the_paper_width() {
        let text = as_text(&render(&ticket()));
        assert!(text.contains(&"-".repeat(32)));
        let mut wide = ticket();
        wide.paper_mm = Some(80);
        assert!(as_text(&render(&wide)).contains(&"-".repeat(48)));
    }

    #[test]
    fn repeats_per_copy_and_clamps_a_silly_count() {
        let mut t = ticket();
        t.copies = Some(2);
        assert_eq!(as_text(&render(&t)).matches("#42").count(), 2);
        t.copies = Some(0);
        assert_eq!(as_text(&render(&t)).matches("#42").count(), 1);
        t.copies = Some(99);
        assert_eq!(as_text(&render(&t)).matches("#42").count(), 5);
    }

    #[test]
    fn wraps_long_names_instead_of_letting_the_printer_truncate() {
        let mut t = ticket();
        t.items[0].name = "Cold Coffee with Ice Cream and Extra Chocolate Sauce".into();
        let text = as_text(&render(&t));
        for line in text.lines() {
            assert!(line.len() <= 40, "line too long for 58mm: {line:?}");
        }
    }

    #[test]
    fn strips_characters_the_printer_cannot_render() {
        let mut t = ticket();
        t.items[0].name = "Café — ₹pecial".into();
        let text = as_text(&render(&t));
        assert!(!text.contains('₹'));
        assert!(!text.contains('—'));
        assert!(text.contains("Caf?"));
    }
}
