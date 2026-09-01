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
//!
//! Two ticket kinds, one shared layout toolkit: `render()` for a full order
//! ticket, `render_update()` for a small "KOT UPDATE" delta slip sent when an
//! already-printed order is edited (see migration 0151). The private helpers
//! below (`render_header`, `item_line`, `item_extras`, `render_kitchen_note`,
//! `render_footer`) are the shared pieces both call — a change to how a
//! quantity or a note is drawn only has to happen once.

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
    /// Where the order came from (qr | pos | waiter | ...). Footer-only —
    /// never anything a cook needs to act on, just useful context.
    #[serde(default)]
    pub source: Option<String>,
    /// The café's own name, printed in the footer. Never the platform's —
    /// this device is white-labelled onto someone else's counter.
    #[serde(default)]
    pub cafe_name: Option<String>,
    /// "NEW ORDER" / "REPRINT" — which `print_jobs.kind` produced this
    /// ticket. Set by the caller (bridge.rs knows the job kind; this struct
    /// never parses one itself) rather than derived here, since the bridge
    /// is the only place that ever sees both the job and its document
    /// together. `None` for a test ticket, which is already self-explanatory
    /// without a status line. Printed as its own loud line so an
    /// automatically-reprinted ticket — auto-printing can legitimately
    /// produce more than one ticket for the same order — can never be
    /// mistaken for a second, unrelated new order at a glance.
    #[serde(default)]
    pub status: Option<String>,
}

/// A change-KOT delta ticket: what got added to and removed from an order
/// that already had a full ticket printed. Same identity fields as `Ticket`,
/// but `items` is replaced by two lists — there is deliberately no `source`
/// here, since a change is triggered by an edit, not by the order's original
/// channel.
#[derive(Deserialize, Clone, Debug)]
pub struct TicketUpdate {
    pub kot_number: String,
    #[serde(default)]
    pub table_label: Option<String>,
    #[serde(default)]
    pub order_type: Option<String>,
    #[serde(default)]
    pub time_label: Option<String>,
    #[serde(default)]
    pub station: Option<String>,
    pub added: Vec<TicketItem>,
    pub removed: Vec<TicketItem>,
    #[serde(default)]
    pub order_note: Option<String>,
    #[serde(default)]
    pub paper_mm: Option<u32>,
    #[serde(default)]
    pub copies: Option<u32>,
    #[serde(default)]
    pub cafe_name: Option<String>,
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
    /// `GS B n` — white-on-black reverse video. Part of the base ESC/POS spec
    /// (Epson and effectively every compatible clone honours it), and the
    /// only way this printer class can render anything resembling the filled
    /// black header bar the browser/native HTML ticket uses — there is no
    /// bordered-box or background-fill equivalent in plain text mode.
    fn reverse(&mut self, on: bool) -> &mut Self {
        self.buf.extend_from_slice(&[GS, b'B', if on { 1 } else { 0 }]);
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

/// The five identity fields `Ticket` and `TicketUpdate` share — everything a
/// ticket's header needs regardless of whether the body ends up being a full
/// item list or an added/removed delta.
struct Header<'a> {
    kot_number: &'a str,
    table_label: Option<&'a str>,
    order_type: Option<&'a str>,
    time_label: Option<&'a str>,
    station: Option<&'a str>,
}

/// The one piece of branded identity this ticket carries — reverse video
/// (white text on a black fill) rather than plain bold, so it reads as "from
/// this café" before a cook reads a single word of the order, matching the
/// filled header bar on the browser/native HTML ticket as closely as plain
/// ESC/POS text mode can. Omitted entirely when there's no café name to show,
/// same as the HTML version.
fn render_brand_bar(b: &mut Builder, cafe_name: Option<&str>, cols: usize) {
    if let Some(name) = cafe_name.map(str::trim).filter(|s| !s.is_empty()) {
        b.align(1).reverse(true).bold(true);
        for l in wrap(&name.to_uppercase(), cols) {
            b.line(&l);
        }
        b.reverse(false).bold(false).align(0);
    }
}

/// "dine_in" → "DINE-IN", "takeaway" → "TAKEAWAY", and so on for whatever
/// `orders.type` holds. No order type at all defaults to "DINE-IN" — a table
/// floor's overwhelming common case, and the same assumption the previous
/// layout made implicitly.
fn order_type_badge(order_type: Option<&str>) -> String {
    match order_type.map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => s.to_uppercase().replace('_', "-"),
        None => "DINE-IN".to_string(),
    }
}

/// Station name, then the single most prominent thing on the ticket — the
/// table number if there is one, otherwise the order type badge — then the
/// order type badge again as its own line (unless it's already the dominant
/// text, which would just repeat it), then the KOT number and time. Every
/// variable-length piece is wrapped at the paper's column width; nothing here
/// is trusted to fit just because it usually does.
fn render_header(b: &mut Builder, h: &Header, cols: usize) {
    if let Some(station) = h.station.map(str::trim).filter(|s| !s.is_empty()) {
        b.align(1).bold(true);
        for l in wrap(&station.to_uppercase(), cols) {
            b.line(&l);
        }
        b.bold(false);
    }

    let badge = order_type_badge(h.order_type);
    let dominant = match h.table_label.map(str::trim).filter(|s| !s.is_empty()) {
        Some(l) => format!("TABLE {l}"),
        None => badge.clone(),
    };

    // Double width, triple height: the biggest thing on the ticket, on
    // purpose — a cook finds the table from across the pass before reading
    // anything else.
    b.align(1).size(1, 2).bold(true);
    let dom_budget = (cols / 2).max(6);
    for l in wrap(&dominant, dom_budget) {
        b.line(&l);
    }
    b.size(0, 0).bold(false);

    if dominant != badge {
        b.align(1).bold(true);
        for l in wrap(&badge, cols) {
            b.line(&l);
        }
        b.bold(false);
    }

    b.align(0).bold(true);
    let meta = match h.time_label.map(str::trim).filter(|t| !t.is_empty()) {
        Some(time) => format!("#{}   {}", h.kot_number, time),
        None => format!("#{}", h.kot_number),
    };
    for l in wrap(&meta, cols) {
        b.line(&l);
    }
    b.bold(false);

    b.line(&"-".repeat(cols));
}

/// Physical width, in normal-width columns, reserved at the front of an item
/// line for its quantity token (marker + qty + " x ", printed at double
/// width). Fixed and generous rather than measured, so the name's wrap
/// budget never has to know exactly how many digits a quantity turned out to
/// have — it just always assumes the worst case and stays safely inside it.
const QTY_TOKEN_RESERVE: usize = 16;

/// One item line: quantity is the loudest part (double width *and* height,
/// bold) because a cook scans "how many" before "what"; the name follows on
/// the same physical line at double height only — still large, but visibly
/// secondary. `marker` prefixes the quantity for a change-KOT line: `+` for
/// an added item, `-` for a removed one, `None` for a normal ticket.
fn item_line(b: &mut Builder, marker: Option<char>, qty: i32, name: &str, cols: usize) {
    b.align(0);
    let token = match marker {
        Some(m) => format!("{m} {qty} x "),
        None => format!("{qty} x "),
    };
    b.size(1, 1).bold(true);
    b.text(&token);
    b.size(0, 1);
    let budget = cols.saturating_sub(QTY_TOKEN_RESERVE).max(8);
    for l in wrap(name, budget) {
        b.line(&l);
    }
    b.size(0, 0).bold(false);
}

/// Modifiers and the item's own note, indented under its line and visually
/// distinct from each other: modifiers plain and "+ "-prefixed, a note bold
/// and "! "-prefixed so it stands out from a modifier at a glance.
fn item_extras(b: &mut Builder, item: &TicketItem, cols: usize) {
    let indent_budget = cols.saturating_sub(2).max(4);
    for m in item.modifiers.iter().map(String::as_str).map(str::trim).filter(|m| !m.is_empty()) {
        for l in wrap(&format!("+ {m}"), indent_budget) {
            b.line(&format!("  {l}"));
        }
    }
    if let Some(note) = item.note.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        b.bold(true);
        for l in wrap(&format!("! {}", note.to_uppercase()), indent_budget) {
            b.line(&format!("  {l}"));
        }
        b.bold(false);
    }
}

/// The kitchen note gets its own visually heavy block — a cook glancing at a
/// stack of tickets needs to spot "no onion on everything" without reading
/// the whole ticket, which a line blended in with the rest would not give
/// them.
fn render_kitchen_note(b: &mut Builder, note: Option<&str>, cols: usize) {
    if let Some(note) = note.map(str::trim).filter(|n| !n.is_empty()) {
        b.line(&"=".repeat(cols));
        b.align(1).bold(true);
        b.line("*** KITCHEN NOTE ***");
        b.align(0);
        for l in wrap(&note.to_uppercase(), cols) {
            b.line(&l);
        }
        b.bold(false);
        b.line(&"=".repeat(cols));
    }
}

/// Minimal on purpose: where the order came from, and the café's own name —
/// never the platform's. Nothing a cook needs to act on lives here.
fn render_footer(b: &mut Builder, source: Option<&str>, cafe_name: Option<&str>, cols: usize) {
    b.align(1);
    if let Some(s) = source.map(str::trim).filter(|s| !s.is_empty()) {
        for l in wrap(&format!("via {}", s.to_uppercase()), cols) {
            b.line(&l);
        }
    }
    if let Some(name) = cafe_name.map(str::trim).filter(|s| !s.is_empty()) {
        for l in wrap(name, cols) {
            b.line(&l);
        }
    }
}

fn render_one(b: &mut Builder, t: &Ticket, cols: usize) {
    render_brand_bar(b, t.cafe_name.as_deref(), cols);
    if let Some(status) = t.status.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        b.align(1).bold(true);
        b.line(&format!("*** {status} ***"));
        b.bold(false);
    }
    render_header(
        b,
        &Header {
            kot_number: &t.kot_number,
            table_label: t.table_label.as_deref(),
            order_type: t.order_type.as_deref(),
            time_label: t.time_label.as_deref(),
            station: t.station.as_deref(),
        },
        cols,
    );

    // A light dotted rule between dishes, not after the last one — real
    // structure separating one item from the next instead of relying on
    // blank-line spacing alone. Matches the HTML ticket's per-item hairline.
    for (i, item) in t.items.iter().enumerate() {
        if i > 0 {
            b.line(&".".repeat(cols));
        }
        item_line(b, None, item.qty, &item.name, cols);
        item_extras(b, item, cols);
        b.feed(1);
    }

    render_kitchen_note(b, t.order_note.as_deref(), cols);
    // A real rule before the footer rather than nothing — the footer used to
    // just trail straight off the last item with no section break at all.
    b.line(&"-".repeat(cols));
    render_footer(b, t.source.as_deref(), t.cafe_name.as_deref(), cols);
    b.feed(3).cut();
}

fn render_update_one(b: &mut Builder, t: &TicketUpdate, cols: usize) {
    render_brand_bar(b, t.cafe_name.as_deref(), cols);

    // A header unmistakably different from a normal ticket's, so a cook can
    // never mistake a change slip for a brand new order.
    b.align(1).bold(true);
    b.line("*** KOT UPDATE ***");
    b.bold(false);

    render_header(
        b,
        &Header {
            kot_number: &t.kot_number,
            table_label: t.table_label.as_deref(),
            order_type: t.order_type.as_deref(),
            time_label: t.time_label.as_deref(),
            station: t.station.as_deref(),
        },
        cols,
    );

    // A dotted rule between entries, skipped only before the very first one —
    // added and removed items share one continuous separator sequence rather
    // than each list getting its own independent numbering.
    let mut first = true;
    for item in t.added.iter().map(|i| (Some('+'), i)).chain(t.removed.iter().map(|i| (Some('-'), i))) {
        if !first {
            b.line(&".".repeat(cols));
        }
        first = false;
        let (marker, item) = item;
        item_line(b, marker, item.qty, &item.name, cols);
        item_extras(b, item, cols);
        b.feed(1);
    }

    render_kitchen_note(b, t.order_note.as_deref(), cols);
    b.line(&"-".repeat(cols));
    render_footer(b, None, t.cafe_name.as_deref(), cols);
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

/// Same idea as `render`, for a change-KOT delta ticket.
pub fn render_update(t: &TicketUpdate) -> Vec<u8> {
    let cols = columns(t.paper_mm.unwrap_or(58));
    let copies = t.copies.unwrap_or(1).clamp(1, 5);
    let mut b = Builder::new();
    for _ in 0..copies {
        render_update_one(&mut b, t, cols);
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
            source: None,
            cafe_name: Some("Brewora".into()),
            status: Some("NEW ORDER".into()),
        }
    }

    /// Decodes the raw ESC/POS bytes into just their printable text, with the
    /// handful of control sequences this file emits stripped out. Needed
    /// because the new layout changes size/bold *mid physical line* (the
    /// quantity token and the item name are two `text()` calls with a `GS !`
    /// in between) — a naive `String::from_utf8_lossy` would leave that
    /// control byte sitting between "2 x " and "Veg Burger", breaking a
    /// substring check that a cook reading the paper would never notice.
    fn as_text(bytes: &[u8]) -> String {
        let mut out = String::new();
        let mut i = 0;
        while i < bytes.len() {
            match bytes[i] {
                ESC => {
                    i += match bytes.get(i + 1) {
                        Some(b'@') => 2,             // ESC @
                        Some(b'E') | Some(b'a') | Some(b'd') => 3, // ESC E/a/d n
                        _ => 2,
                    };
                }
                GS => {
                    i += match bytes.get(i + 1) {
                        Some(b'!') => 3, // GS ! n
                        Some(b'V') => 4, // GS V m n
                        Some(b'B') => 3, // GS B n
                        _ => 2,
                    };
                }
                b => {
                    out.push(b as char);
                    i += 1;
                }
            }
        }
        out
    }

    #[test]
    fn shows_the_status_line_when_set() {
        let mut t = ticket();
        t.status = Some("NEW ORDER".into());
        assert!(as_text(&render(&t)).contains("*** NEW ORDER ***"));
        t.status = Some("REPRINT".into());
        assert!(as_text(&render(&t)).contains("*** REPRINT ***"));
    }

    #[test]
    fn omits_the_status_line_when_none() {
        let mut t = ticket();
        t.status = None;
        assert!(!as_text(&render(&t)).contains("***"));
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
        assert!(text.contains("TABLE T08"));
        assert!(text.contains("7:42 PM"));
        assert!(text.contains("2 x Veg Burger"));
        assert!(text.contains("Extra Cheese"));
        assert!(text.contains("NO ONION"));
    }

    #[test]
    fn never_prints_money() {
        let text = as_text(&render(&ticket()));
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

    #[test]
    fn footer_carries_the_order_source() {
        let mut t = ticket();
        t.source = Some("qr".into());
        let text = as_text(&render(&t));
        assert!(text.contains("QR"));
    }

    #[test]
    fn footer_shows_the_cafes_own_name_not_the_platforms() {
        let t = ticket();
        let text = as_text(&render(&t));
        assert!(text.contains("Brewora"), "expected the cafe's own name, got {text:?}");
        assert!(!text.contains("KhaoPiyo"), "the ticket must never print the platform's brand, got {text:?}");
    }

    #[test]
    fn footer_omits_the_cafe_name_line_when_none_is_given() {
        let mut t = ticket();
        t.cafe_name = None;
        let text = as_text(&render(&t));
        assert!(!text.contains("KhaoPiyo"), "must not fall back to the platform brand, got {text:?}");
    }

    #[test]
    fn prints_a_reverse_video_brand_bar_with_the_cafes_name() {
        let bytes = render(&ticket());
        // The brand bar is the very first thing after ESC @ (init): align
        // centre, GS B 1 (reverse on), bold on, then the uppercased name.
        assert_eq!(&bytes[2..5], &[ESC, b'a', 1], "expected centre-align right after init");
        assert!(
            bytes.windows(3).any(|w| w == [GS, b'B', 1]),
            "expected GS B 1 (reverse video on) somewhere in the ticket"
        );
        assert!(
            bytes.windows(3).any(|w| w == [GS, b'B', 0]),
            "expected GS B 0 (reverse video off) — the bar must not stay reversed for the rest of the ticket"
        );
        let text = as_text(&bytes);
        assert!(text.contains("BREWORA"), "expected the uppercased cafe name in the brand bar, got {text:?}");
    }

    #[test]
    fn omits_the_brand_bar_entirely_when_no_cafe_name_given() {
        let mut t = ticket();
        t.cafe_name = None;
        let bytes = render(&t);
        assert!(
            !bytes.windows(3).any(|w| w == [GS, b'B', 1]),
            "no cafe name means no brand bar, so reverse video should never turn on at all"
        );
    }

    #[test]
    fn separates_multiple_items_with_a_dotted_rule() {
        let mut t = ticket();
        t.items.push(TicketItem { qty: 1, name: "Cold Coffee".into(), modifiers: vec![], note: None });
        let text = as_text(&render(&t));
        assert!(text.contains(&".".repeat(32)), "expected a dotted rule between the two items, got {text:?}");
        // Exactly one separator for two items — not one before every item.
        assert_eq!(text.matches(&".".repeat(32)).count(), 1);
    }

    #[test]
    fn does_not_print_a_dotted_rule_for_a_single_item() {
        let text = as_text(&render(&ticket()));
        assert!(!text.contains(&".".repeat(32)), "a single-item ticket has nothing to separate, got {text:?}");
    }

    #[test]
    fn wraps_a_long_kitchen_note_without_overflowing_the_paper_width() {
        let mut t = ticket();
        t.order_note = Some(
            "please make it extra spicy and pack the sauces separately in a small container on the side"
                .into(),
        );
        let text = as_text(&render(&t));
        assert!(text.contains("KITCHEN NOTE"));
        for line in text.lines() {
            assert!(line.len() <= 32, "line too long for 58mm: {line:?}");
        }
    }

    #[test]
    fn kot_update_marks_added_and_removed_items() {
        let t = TicketUpdate {
            kot_number: "42".into(),
            table_label: Some("T08".into()),
            order_type: Some("dine_in".into()),
            time_label: None,
            station: None,
            added: vec![TicketItem {
                qty: 1,
                name: "Cold Coffee".into(),
                modifiers: vec![],
                note: None,
            }],
            removed: vec![TicketItem {
                qty: 1,
                name: "Burger".into(),
                modifiers: vec![],
                note: None,
            }],
            order_note: None,
            paper_mm: Some(58),
            copies: None,
            cafe_name: Some("Brewora".into()),
        };
        let text = as_text(&render_update(&t));
        assert!(text.contains("KOT UPDATE"));
        assert!(text.contains("+ 1 x Cold Coffee"));
        assert!(text.contains("- 1 x Burger"));
    }

    #[test]
    fn strips_non_ascii_from_modifiers_and_notes_without_panicking() {
        let mut t = ticket();
        t.items[0].modifiers = vec!["Extra ₹pice — café style".into()];
        t.items[0].note = Some("café note — ₹".into());
        let text = as_text(&render(&t));
        assert!(!text.contains('₹'));
        assert!(!text.contains('—'));
        // Modifiers keep their original case, so ascii() drops the lowercase
        // é straight to '?': "café" → "caf?".
        assert!(text.contains("caf?"), "modifier text not sanitized: {text:?}");
        // The item note is uppercased before sanitizing, so "café" → "CAFÉ"
        // → "CAF?" once the printer-unsafe É is dropped.
        assert!(text.contains("CAF?"), "note text not sanitized: {text:?}");
    }
}
