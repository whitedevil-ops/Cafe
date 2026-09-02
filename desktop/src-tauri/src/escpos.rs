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
//! below (`render_brand_bar`, `render_status`, `render_header`,
//! `render_columns`, `item_line`, `item_extras`, `render_order_note`,
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
    /// Where the order came from (qr | pos | waiter | ...). Printed small in
    /// the header's meta block — never anything a cook needs to act on, just
    /// useful context.
    #[serde(default)]
    pub source: Option<String>,
    /// The café's own name, printed in the brand bar and the footer. Never
    /// the platform's — this device is white-labelled onto someone else's
    /// counter.
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

/// Pad a line out to the full paper width with the text centred inside it.
/// Only the reverse-video brand bar needs this: `ESC a 1` centres the glyphs
/// but leaves the fill hugging them, so a centred name prints as a black
/// smudge instead of the solid bar the HTML ticket draws. Padding first makes
/// the reversed run span the roll. Lines already at or over the width are
/// returned untouched — `wrap()` has done its job by then.
fn center(s: &str, width: usize) -> String {
    let len = s.chars().count();
    if len >= width {
        return s.to_string();
    }
    let left = (width - len) / 2;
    format!("{}{}{}", " ".repeat(left), s, " ".repeat(width - len - left))
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

/// The identity fields `Ticket` and `TicketUpdate` share — everything a
/// ticket's header needs regardless of whether the body ends up being a full
/// item list or an added/removed delta. `source` is always `None` for an
/// update, which is triggered by an edit rather than by the order's original
/// channel.
struct Header<'a> {
    kot_number: &'a str,
    table_label: Option<&'a str>,
    order_type: Option<&'a str>,
    time_label: Option<&'a str>,
    station: Option<&'a str>,
    source: Option<&'a str>,
}

/// The one piece of branded identity this ticket carries — reverse video
/// (white text on a black fill) rather than plain bold, so it reads as "from
/// this café" before a cook reads a single word of the order, matching the
/// filled header bar on the browser/native HTML ticket as closely as plain
/// ESC/POS text mode can. Omitted entirely when there's no café name to show,
/// same as the HTML version.
fn render_brand_bar(b: &mut Builder, cafe_name: Option<&str>, cols: usize) {
    if let Some(name) = cafe_name.map(str::trim).filter(|s| !s.is_empty()) {
        // Padded to the full width and printed left-aligned rather than
        // centred by the printer: the fill has to reach both edges of the
        // roll, which it only does if the spaces are really there.
        b.align(0).reverse(true).bold(true);
        for l in wrap(&name.to_uppercase(), cols) {
            b.line(&center(&l, cols));
        }
        b.reverse(false).bold(false);
    }
}

/// Which kind of ticket this is — "NEW ORDER", "KOT UPDATE", "REPRINT" — as
/// one loud centred line directly under the brand bar. Auto-printing can
/// legitimately emit more than one ticket for the same order, so this is what
/// stops a reprint being read as a second, unrelated order. Omitted when the
/// caller has no status to give (a test ticket), which is already
/// self-explanatory.
fn render_status(b: &mut Builder, status: Option<&str>, cols: usize) {
    if let Some(s) = status.map(str::trim).filter(|s| !s.is_empty()) {
        b.align(1).bold(true);
        for l in wrap(&format!("*** {} ***", s.to_uppercase()), cols) {
            b.line(&l);
        }
        b.bold(false).align(0);
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

/// The KOT number, then the single most prominent thing on the ticket — the
/// table if there is one, otherwise the order type — then the order type
/// again as its own line (unless it's already the hero text, which would just
/// repeat it), then the small meta block: when the order was placed, where it
/// came from, which station it belongs to.
///
/// The ordering is the point. Staff match a paper ticket to a rack slot by
/// its number, and find the right ticket from across the pass by its table,
/// so those two are the only things printed large; everything else is context
/// they read once they are already holding the right slip. Every
/// variable-length piece is wrapped at the paper's column width; nothing here
/// is trusted to fit just because it usually does.
fn render_header(b: &mut Builder, h: &Header, cols: usize) {
    // Double width and height, left-aligned: the second-loudest thing on the
    // ticket and the one staff actually call out to each other.
    let big_budget = (cols / 2).max(6);
    b.align(0).size(1, 1).bold(true);
    for l in wrap(&format!("KOT #{}", h.kot_number), big_budget) {
        b.line(&l);
    }
    b.size(0, 0).bold(false);

    let badge = order_type_badge(h.order_type);
    let hero = match h.table_label.map(str::trim).filter(|s| !s.is_empty()) {
        Some(l) => format!("TABLE {}", l.to_uppercase()),
        None => badge.clone(),
    };

    // Double width, triple height: the biggest thing on the ticket, on
    // purpose — a cook finds the table from across the pass before reading
    // anything else.
    b.align(1).size(1, 2).bold(true);
    for l in wrap(&hero, big_budget) {
        b.line(&l);
    }
    b.size(0, 0).bold(false);

    if hero != badge {
        b.align(1).bold(true);
        for l in wrap(&badge, cols) {
            b.line(&l);
        }
        b.bold(false);
    }

    // Context, not instruction: the smallest, plainest type on the ticket.
    // The time is when the order was placed, never when this happened to
    // print — a reprint pulled an hour later must still say when the guest
    // ordered, or the line dresses a stale ticket up as a fresh one.
    b.align(1);
    if let Some(time) = h.time_label.map(str::trim).filter(|t| !t.is_empty()) {
        for l in wrap(&time.to_uppercase(), cols) {
            b.line(&l);
        }
    }

    // Source and station share one line, and it disappears entirely when
    // there's nothing to put on it rather than printing an empty label.
    let mut meta: Vec<String> = Vec::new();
    if let Some(source) = h.source.map(str::trim).filter(|s| !s.is_empty()) {
        meta.push(format!("SOURCE: {}", source.to_uppercase()));
    }
    if let Some(station) = h.station.map(str::trim).filter(|s| !s.is_empty()) {
        meta.push(format!("STATION: {}", station.to_uppercase()));
    }
    if !meta.is_empty() {
        for l in wrap(&meta.join(" | "), cols) {
            b.line(&l);
        }
    }
    b.align(0);
}

/// The column header over the item list: rule, "QTY  ITEM", rule. The list is
/// a table, so it gets headings — and the leading number then reads as a
/// quantity rather than as part of the dish name. Printed as a literal rather
/// than wrapped, since wrapping would collapse the double space that lines
/// the two columns up.
fn render_columns(b: &mut Builder, cols: usize) {
    b.align(0).line(&"-".repeat(cols));
    b.bold(true).line("QTY  ITEM").bold(false);
    b.line(&"-".repeat(cols));
}

/// "ADDED" / "REMOVED" over one half of a change ticket: big, bold, and
/// underlined by its own rule. Which half of a delta a cook is reading is far
/// too important to hang on a single +/- character at the front of a line.
fn render_group_head(b: &mut Builder, title: &str, cols: usize) {
    b.align(0).size(0, 1).bold(true);
    b.line(title);
    b.size(0, 0).bold(false);
    b.line(&"-".repeat(cols));
}

/// One item line: quantity is the loudest part (double width *and* height,
/// bold) because a cook scans "how many" before "what"; the name follows on
/// the same physical line at double height only — still large, but visibly
/// secondary. `marker` prefixes the quantity for a change-KOT line: `+` for
/// an added item, `-` for a removed one, `None` for a normal ticket.
///
/// The quantity token prints at double width, so it costs two columns per
/// character. Both the name's wrap budget and the indent its continuation
/// lines hang at are measured from that — otherwise a long name either
/// overruns the roll or wraps back under the quantity, which reads as a
/// second dish.
fn item_line(b: &mut Builder, marker: Option<char>, qty: i32, name: &str, cols: usize) {
    b.align(0);
    let token = match marker {
        Some(m) => format!("{m} {qty} x "),
        None => format!("{qty} x "),
    };
    let indent = (token.chars().count() * 2).min(cols.saturating_sub(8));
    let budget = cols.saturating_sub(indent).max(8);
    b.size(1, 1).bold(true);
    b.text(&token);
    b.size(0, 1);
    for (i, l) in wrap(name, budget).into_iter().enumerate() {
        if i > 0 {
            b.text(&" ".repeat(indent));
        }
        b.line(&l);
    }
    b.size(0, 0).bold(false);
}

/// "+ Extra Cheese" / "- No Onion". Modifiers are free text — nothing in the
/// data model says which are going on the dish and which are coming off it —
/// so their own wording is the only signal there is: a leading sign, or a
/// "no"/"without"/"hold" phrasing, is a removal. Kept identical to `modLine`
/// in lib/kot-print.ts.
fn mod_line(m: &str) -> String {
    let lower = m.to_lowercase();
    let removal = lower.starts_with('-')
        || ["no", "without", "hold"].iter().any(|w| {
            lower
                .strip_prefix(*w)
                .map_or(false, |rest| !rest.starts_with(|c: char| c.is_alphanumeric() || c == '_'))
        });
    let body = m.strip_prefix('+').or_else(|| m.strip_prefix('-')).unwrap_or(m).trim();
    format!("{} {}", if removal { '-' } else { '+' }, body)
}

/// Modifiers and the item's own note, indented under its line at normal size
/// — deliberately smaller and plainer than the double-height name above them,
/// because a modifier that reads as large as an item name reads as a second
/// dish. The note is bold and "NOTE: "-prefixed so it can't be skimmed past
/// as one more modifier.
fn item_extras(b: &mut Builder, item: &TicketItem, cols: usize) {
    let indent_budget = cols.saturating_sub(2).max(4);
    for m in item.modifiers.iter().map(String::as_str).map(str::trim).filter(|m| !m.is_empty()) {
        for l in wrap(&mod_line(m), indent_budget) {
            b.line(&format!("  {l}"));
        }
    }
    if let Some(note) = item.note.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        b.bold(true);
        for l in wrap(&format!("NOTE: {}", note.to_uppercase()), indent_budget) {
            b.line(&format!("  {l}"));
        }
        b.bold(false);
    }
}

/// The order-wide note gets its own visually heavy block, fenced top and
/// bottom — a cook glancing at a stack of tickets needs to spot "no onion on
/// anything" without reading the whole ticket, which a line blended in with
/// the rest would not give them. Double height on the body, since this is the
/// one piece of free text that changes how every item is made.
fn render_order_note(b: &mut Builder, note: Option<&str>, cols: usize) {
    if let Some(note) = note.map(str::trim).filter(|n| !n.is_empty()) {
        b.align(0).line(&"=".repeat(cols));
        b.align(1).bold(true);
        b.line("!!! ORDER NOTE !!!");
        b.align(0).size(0, 1);
        for l in wrap(&note.to_uppercase(), cols) {
            b.line(&l);
        }
        b.size(0, 0).bold(false);
        b.line(&"=".repeat(cols));
    }
}

/// Minimal on purpose: a rule to close the ticket off, the café's own name —
/// never the platform's — and, when a printer is set to run more than one,
/// which copy this is, so two identical slips on a pass are obviously the
/// same order rather than two of it. Nothing a cook needs to act on lives
/// here.
fn render_footer(b: &mut Builder, cafe_name: Option<&str>, copy: u32, copies: u32, cols: usize) {
    b.align(0).line(&"-".repeat(cols));
    b.align(1);
    if let Some(name) = cafe_name.map(str::trim).filter(|s| !s.is_empty()) {
        for l in wrap(name, cols) {
            b.line(&l);
        }
    }
    if copies > 1 {
        b.line(&format!("COPY {copy}/{copies}"));
    }
    b.align(0);
}

/// One list of items, marked and separated. A light dotted rule between
/// dishes, never before the first or after the last — real structure
/// separating one item from the next instead of relying on blank-line spacing
/// alone. Matches the HTML ticket's per-item hairline.
fn render_items(b: &mut Builder, items: &[TicketItem], marker: Option<char>, cols: usize) {
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            b.line(&".".repeat(cols));
        }
        item_line(b, marker, item.qty, &item.name, cols);
        item_extras(b, item, cols);
        b.feed(1);
    }
}

fn render_one(b: &mut Builder, t: &Ticket, cols: usize, copy: u32, copies: u32) {
    render_brand_bar(b, t.cafe_name.as_deref(), cols);
    render_status(b, t.status.as_deref(), cols);
    render_header(
        b,
        &Header {
            kot_number: &t.kot_number,
            table_label: t.table_label.as_deref(),
            order_type: t.order_type.as_deref(),
            time_label: t.time_label.as_deref(),
            station: t.station.as_deref(),
            source: t.source.as_deref(),
        },
        cols,
    );

    render_columns(b, cols);
    render_items(b, &t.items, None, cols);

    render_order_note(b, t.order_note.as_deref(), cols);
    render_footer(b, t.cafe_name.as_deref(), copy, copies, cols);
    b.feed(3).cut();
}

fn render_update_one(b: &mut Builder, t: &TicketUpdate, cols: usize, copy: u32, copies: u32) {
    render_brand_bar(b, t.cafe_name.as_deref(), cols);
    // A status line unmistakably different from a new order's, so a cook can
    // never mistake a change slip for a brand new order.
    render_status(b, Some("KOT UPDATE"), cols);
    render_header(
        b,
        &Header {
            kot_number: &t.kot_number,
            table_label: t.table_label.as_deref(),
            order_type: t.order_type.as_deref(),
            time_label: t.time_label.as_deref(),
            station: t.station.as_deref(),
            source: None,
        },
        cols,
    );

    render_columns(b, cols);

    // Two titled groups rather than one run of +/- lines. A group with
    // nothing in it is not printed at all: an empty "REMOVED" heading is
    // worse than no heading, because it invites a cook to go hunting for what
    // is missing.
    if !t.added.is_empty() {
        render_group_head(b, "ADDED", cols);
        render_items(b, &t.added, Some('+'), cols);
    }
    if !t.removed.is_empty() {
        render_group_head(b, "REMOVED", cols);
        render_items(b, &t.removed, Some('-'), cols);
    }

    // The whole point of the slip, spelled out: everything not listed above
    // was already sent and is already being made.
    b.align(0).line(&"-".repeat(cols));
    b.align(1).bold(true);
    b.line("PREPARE CHANGES ONLY");
    b.bold(false).align(0);

    render_order_note(b, t.order_note.as_deref(), cols);
    render_footer(b, t.cafe_name.as_deref(), copy, copies, cols);
    b.feed(3).cut();
}

pub fn render(t: &Ticket) -> Vec<u8> {
    let cols = columns(t.paper_mm.unwrap_or(58));
    let copies = t.copies.unwrap_or(1).clamp(1, 5);
    let mut b = Builder::new();
    for i in 0..copies {
        render_one(&mut b, t, cols, i + 1, copies);
    }
    b.buf
}

/// Same idea as `render`, for a change-KOT delta ticket.
pub fn render_update(t: &TicketUpdate) -> Vec<u8> {
    let cols = columns(t.paper_mm.unwrap_or(58));
    let copies = t.copies.unwrap_or(1).clamp(1, 5);
    let mut b = Builder::new();
    for i in 0..copies {
        render_update_one(&mut b, t, cols, i + 1, copies);
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

    fn update_ticket() -> TicketUpdate {
        TicketUpdate {
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
        assert!(text.contains("KOT #42"));
        assert!(text.contains("TABLE T08"));
        assert!(text.contains("7:42 PM"));
        assert!(text.contains("2 x Veg Burger"));
        assert!(text.contains("+ Extra Cheese"));
        assert!(text.contains("NOTE: NO ONION"));
    }

    #[test]
    fn signs_a_modifier_by_its_own_wording() {
        let mut t = ticket();
        t.items[0].modifiers = vec![
            "Extra Cheese".into(),
            "No Onion".into(),
            "without mayo".into(),
            "- pickles".into(),
            "Nonstick pan".into(), // "no" only counts as a whole word
        ];
        let text = as_text(&render(&t));
        assert!(text.contains("+ Extra Cheese"));
        assert!(text.contains("- No Onion"));
        assert!(text.contains("- without mayo"));
        assert!(text.contains("- pickles"), "a modifier already signed must not end up '- - pickles': {text:?}");
        assert!(text.contains("+ Nonstick pan"));
    }

    #[test]
    fn heads_the_item_list_with_its_columns() {
        let text = as_text(&render(&ticket()));
        assert!(text.contains("QTY  ITEM"), "expected a column header above the items, got {text:?}");
    }

    #[test]
    fn never_prints_money() {
        let text = as_text(&render(&ticket())).to_lowercase();
        for word in ["total", "subtotal", "gst", "discount", "payment"] {
            assert!(!text.contains(word), "a KOT is not a bill; found {word:?} in {text:?}");
        }
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
    fn numbers_the_copies_only_when_there_is_more_than_one() {
        let mut t = ticket();
        assert!(!as_text(&render(&t)).contains("COPY"), "a single ticket is not copy 1 of 1");
        t.copies = Some(2);
        let text = as_text(&render(&t));
        assert!(text.contains("COPY 1/2"), "expected a copy marker, got {text:?}");
        assert!(text.contains("COPY 2/2"), "expected a copy marker, got {text:?}");
    }

    #[test]
    fn header_carries_the_station_when_there_is_one() {
        let mut t = ticket();
        assert!(!as_text(&render(&t)).contains("STATION"));
        t.station = Some("bar".into());
        assert!(as_text(&render(&t)).contains("STATION: BAR"));
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
    fn header_carries_the_order_source() {
        let mut t = ticket();
        t.source = Some("qr".into());
        let text = as_text(&render(&t));
        assert!(text.contains("SOURCE: QR"), "expected the source in the meta block, got {text:?}");
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
        // left (the name is padded to full width itself, so the fill reaches
        // both edges), GS B 1 (reverse on), bold on, then the uppercased name.
        assert_eq!(&bytes[2..5], &[ESC, b'a', 0], "expected left-align right after init");
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
        let bar = text.lines().next().unwrap_or_default();
        assert_eq!(bar.len(), 32, "the bar must be padded to the full paper width, got {bar:?}");
        assert_eq!(bar.trim(), "BREWORA");
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
    fn wraps_a_long_order_note_without_overflowing_the_paper_width() {
        let mut t = ticket();
        t.order_note = Some(
            "please make it extra spicy and pack the sauces separately in a small container on the side"
                .into(),
        );
        let text = as_text(&render(&t));
        assert!(text.contains("!!! ORDER NOTE !!!"));
        assert!(text.contains("PACK THE SAUCES"));
        for line in text.lines() {
            assert!(line.len() <= 32, "line too long for 58mm: {line:?}");
        }
    }

    #[test]
    fn kot_update_marks_added_and_removed_items() {
        let text = as_text(&render_update(&update_ticket()));
        assert!(text.contains("*** KOT UPDATE ***"));
        assert!(text.contains("ADDED"));
        assert!(text.contains("+ 1 x Cold Coffee"));
        assert!(text.contains("REMOVED"));
        assert!(text.contains("- 1 x Burger"));
        assert!(text.contains("PREPARE CHANGES ONLY"));
    }

    #[test]
    fn kot_update_omits_a_section_with_nothing_in_it() {
        let mut t = update_ticket();
        t.removed.clear();
        let text = as_text(&render_update(&t));
        assert!(text.contains("ADDED"));
        assert!(!text.contains("REMOVED"), "an empty section must not print its own header, got {text:?}");

        let mut t = update_ticket();
        t.added.clear();
        let text = as_text(&render_update(&t));
        assert!(text.contains("REMOVED"));
        assert!(!text.contains("ADDED"), "an empty section must not print its own header, got {text:?}");
    }

    #[test]
    fn kot_update_numbers_its_copies_too() {
        let mut t = update_ticket();
        t.copies = Some(2);
        let text = as_text(&render_update(&t));
        assert!(text.contains("COPY 1/2"));
        assert!(text.contains("COPY 2/2"));
    }

    #[test]
    fn kot_update_stays_inside_the_paper_width() {
        let mut t = update_ticket();
        t.added[0].name = "Cold Coffee with Ice Cream and Extra Chocolate Sauce".into();
        t.added[0].modifiers = vec!["no sugar in either of the two glasses please".into()];
        t.order_note = Some("the whole order goes out together, nothing before that".into());
        for line in as_text(&render_update(&t)).lines() {
            assert!(line.len() <= 32, "line too long for 58mm: {line:?}");
        }
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
