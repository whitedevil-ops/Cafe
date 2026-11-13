import { describe, it, expect } from 'vitest'
import {
  buildTallyXml,
  closedBusinessDays,
  MAX_EXPORT_DAYS,
  rateKey,
  tallyFileName,
  TallyExportError,
  type GstDay,
  type TallyLedgers,
} from '@/lib/tally-export'

// The Tally export is only worth shipping if every file it writes imports
// cleanly, and the commonest ways an import fails are accounting ones: a
// voucher that does not balance, a ledger name that is blank or mangled, a day
// that is exported twice. These tests pin each of those. They cannot prove
// Tally accepts the tags (no Tally runs here — see docs/tally-export.md); they
// prove the numbers and the structure.

const ledgers: TallyLedgers = {
  party: 'Counter Sales',
  salesByRate: { '5': 'Sales GST 5%', '18': 'Sales GST 18%' },
  cgst: 'Output CGST',
  sgst: 'Output SGST',
  salesReturn: 'Sales Returns',
}

const day = (over: Partial<GstDay> = {}): GstDay => ({
  date: '2026-11-10',
  byRate: [{ tax_percent: 5, taxable_value: 1000, cgst: 25, sgst: 25 }],
  invoiceCount: 12,
  firstInvoice: 'INV-001',
  lastInvoice: 'INV-012',
  creditNotes: [],
  ...over,
})

// Pulls every ledger entry out of one voucher as {ledger, debit, amount}.
function entriesOf(xml: string) {
  return [...xml.matchAll(/<LEDGERENTRIES\.LIST>([\s\S]*?)<\/LEDGERENTRIES\.LIST>/g)].map((m) => ({
    ledger: /<LEDGERNAME>(.*?)<\/LEDGERNAME>/.exec(m[1])![1],
    debit: /<ISDEEMEDPOSITIVE>(.*?)</.exec(m[1])![1] === 'Yes',
    amount: Number(/<AMOUNT>(.*?)<\/AMOUNT>/.exec(m[1])![1]),
  }))
}
const vouchersOf = (xml: string) => [...xml.matchAll(/<VOUCHER [\s\S]*?<\/VOUCHER>/g)].map((m) => m[0])

// Not a full XML parser — a stack check that every tag opens and closes in
// order, which is what "well-formed" breaks on when text is not escaped.
function assertWellFormed(xml: string) {
  const stack: string[] = []
  for (const m of xml.replace(/<\?xml[\s\S]*?\?>/, '').matchAll(/<(\/?)([A-Za-z][\w.:-]*)[^>]*?(\/?)>/g)) {
    if (m[3] === '/') continue
    if (m[1] === '/') expect(stack.pop()).toBe(m[2])
    else stack.push(m[2])
  }
  expect(stack).toEqual([])
}

describe('sales voucher', () => {
  it('writes one balanced voucher per day: party debited, sales and tax credited', () => {
    const r = buildTallyXml({ ledgers, days: [day()] })
    expect(r.salesVouchers).toBe(1)
    const entries = entriesOf(r.xml)
    // Tally's convention: debit = deemed-positive with a NEGATIVE amount.
    expect(entries).toEqual([
      { ledger: 'Counter Sales', debit: true, amount: -1050 },
      { ledger: 'Sales GST 5%', debit: false, amount: 1000 },
      { ledger: 'Output CGST', debit: false, amount: 25 },
      { ledger: 'Output SGST', debit: false, amount: 25 },
    ])
    expect(entries.reduce((s, e) => s + e.amount, 0)).toBe(0)
  })

  it('uses a stable voucher number and a YYYYMMDD date so a re-import can be detected', () => {
    const { xml } = buildTallyXml({ ledgers, days: [day()] })
    expect(xml).toContain('<VOUCHERNUMBER>KP-GST-20261110</VOUCHERNUMBER>')
    expect(xml).toContain('<DATE>20261110</DATE>')
    expect(xml).toContain('VCHTYPE="Sales" ACTION="Create"')
    expect(xml).toContain('<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>')
  })

  it('names the invoice range in the narration', () => {
    expect(buildTallyXml({ ledgers, days: [day()] }).xml).toContain('12 invoices INV-001 to INV-012')
    expect(buildTallyXml({ ledgers, days: [day({ invoiceCount: 1, firstInvoice: 'INV-007', lastInvoice: 'INV-007' })] }).xml).toContain('1 invoice INV-007')
  })

  it('splits a day across rates and sums several HSN codes that share a rate', () => {
    const r = buildTallyXml({
      ledgers,
      days: [
        day({
          byRate: [
            { tax_percent: 5, taxable_value: 600, cgst: 15, sgst: 15 },
            { tax_percent: 18, taxable_value: 200, cgst: 18, sgst: 18 },
            { tax_percent: 5, taxable_value: 400, cgst: 10, sgst: 10 }, // second HSN, same 5% rate
          ],
        }),
      ],
    })
    const e = entriesOf(r.xml)
    expect(e.find((x) => x.ledger === 'Sales GST 5%')!.amount).toBe(1000)
    expect(e.find((x) => x.ledger === 'Sales GST 18%')!.amount).toBe(200)
    expect(e.find((x) => x.ledger === 'Output CGST')!.amount).toBe(43)
    expect(e.find((x) => x.ledger === 'Counter Sales')!.amount).toBe(-(1000 + 200 + 43 + 43))
    expect(r.sales).toEqual({ taxable: 1200, cgst: 43, sgst: 43 })
  })

  it('balances to the paisa even when the amounts carry fractions', () => {
    // 0.1 + 0.2 style sums are exactly what float arithmetic gets wrong.
    const r = buildTallyXml({ ledgers, days: [day({ byRate: [{ tax_percent: 5, taxable_value: 100.1, cgst: 2.5, sgst: 2.55 }] })] })
    const e = entriesOf(r.xml)
    expect(e.reduce((s, x) => s + Math.round(x.amount * 100), 0)).toBe(0)
    expect(e[0].amount).toBe(-105.15)
  })

  it('writes nothing for a day with no sales, and warns when invoices exist without a breakdown', () => {
    expect(buildTallyXml({ ledgers, days: [day({ byRate: [], invoiceCount: 0, firstInvoice: null, lastInvoice: null })] }).vouchers).toBe(0)
    const r = buildTallyXml({ ledgers, days: [day({ byRate: [] })] })
    expect(r.vouchers).toBe(0)
    expect(r.warnings.join(' ')).toContain('no tax breakdown')
  })

  it('produces one voucher per day, in the order given', () => {
    const r = buildTallyXml({ ledgers, days: [day({ date: '2026-11-09' }), day({ date: '2026-11-10' })] })
    expect(vouchersOf(r.xml).map((v) => /<VOUCHERNUMBER>(.*?)</.exec(v)![1])).toEqual(['KP-GST-20261109', 'KP-GST-20261110'])
  })
})

describe('credit notes', () => {
  const withCn = (over = {}) =>
    day({
      byRate: [],
      invoiceCount: 0,
      firstInvoice: null,
      lastInvoice: null,
      creditNotes: [{ credit_note_number: 'CN-001', taxable_value: 100, cgst: 2.5, sgst: 2.5, amount: 105, reason: 'wrong order', ...over }],
    })

  it('mirrors a sale: sales-returns and tax debited, party credited', () => {
    const r = buildTallyXml({ ledgers, days: [withCn()] })
    expect(r.creditNotes).toBe(1)
    expect(entriesOf(r.xml)).toEqual([
      { ledger: 'Sales Returns', debit: true, amount: -100 },
      { ledger: 'Output CGST', debit: true, amount: -2.5 },
      { ledger: 'Output SGST', debit: true, amount: -2.5 },
      { ledger: 'Counter Sales', debit: false, amount: 105 },
    ])
    expect(r.xml).toContain('VCHTYPE="Credit Note"')
    expect(r.xml).toContain('<VOUCHERNUMBER>CN-001</VOUCHERNUMBER>')
    expect(r.returns).toEqual({ taxable: 100, cgst: 2.5, sgst: 2.5 })
  })

  it('needs no per-rate ledger, so a credit note on a rate we have no sales ledger for still exports', () => {
    const r = buildTallyXml({ ledgers: { ...ledgers, salesByRate: {} }, days: [withCn()] })
    expect(r.creditNotes).toBe(1)
  })

  it('warns when the refunded amount is not taxable + tax, and still balances on the components', () => {
    const r = buildTallyXml({ ledgers, days: [withCn({ amount: 90 })] })
    expect(r.warnings.join(' ')).toContain('CN-001')
    expect(entriesOf(r.xml).reduce((s, e) => s + Math.round(e.amount * 100), 0)).toBe(0)
  })

  it('does not warn about a rupee of rounding', () => {
    expect(buildTallyXml({ ledgers, days: [withCn({ amount: 104.4 })] }).warnings).toEqual([])
  })

  it('skips a credit note with no value', () => {
    const r = buildTallyXml({ ledgers, days: [withCn({ taxable_value: 0, cgst: 0, sgst: 0, amount: 0 })] })
    expect(r.creditNotes).toBe(0)
    expect(r.warnings.join(' ')).toContain('skipped')
  })
})

describe('ledger names', () => {
  it('refuses a rate that has no sales ledger, naming the rate and the day', () => {
    const bad = day({ byRate: [{ tax_percent: 12, taxable_value: 100, cgst: 6, sgst: 6 }] })
    expect(() => buildTallyXml({ ledgers, days: [bad] })).toThrow(TallyExportError)
    expect(() => buildTallyXml({ ledgers, days: [bad] })).toThrow(/12% GST.*2026-11-10/)
  })

  it('refuses blank fixed ledgers (whitespace counts as blank)', () => {
    for (const key of ['party', 'cgst', 'sgst', 'salesReturn'] as const) {
      expect(() => buildTallyXml({ ledgers: { ...ledgers, [key]: '   ' }, days: [day()] })).toThrow(TallyExportError)
    }
  })

  it('trims names, because a trailing space is the classic "ledger does not exist"', () => {
    const r = buildTallyXml({ ledgers: { ...ledgers, party: '  Counter Sales  ' }, days: [day()] })
    expect(r.xml).toContain('<LEDGERNAME>Counter Sales</LEDGERNAME>')
  })

  it('maps 2.5 and 5.0 style rates to the same key the UI uses', () => {
    expect(rateKey(5)).toBe('5')
    expect(rateKey(5.0)).toBe('5')
    expect(rateKey(2.5)).toBe('2.5')
    expect(rateKey(18)).toBe('18')
  })
})

describe('XML safety', () => {
  it('escapes ledger, company and narration text so the file stays well-formed', () => {
    const r = buildTallyXml({
      company: 'Sharma & Sons <Cafe>',
      ledgers: { ...ledgers, party: 'Cash "A&B" Sales', salesByRate: { '5': "Sales 5% (Dine-in's)" } },
      days: [day({ creditNotes: [{ credit_note_number: 'CN-9', taxable_value: 10, cgst: 0.25, sgst: 0.25, amount: 10.5, reason: 'too <salty> & cold' }] })],
    })
    expect(r.xml).toContain('Sharma &amp; Sons &lt;Cafe&gt;')
    expect(r.xml).toContain('Cash &quot;A&amp;B&quot; Sales')
    expect(r.xml).toContain('Dine-in&apos;s')
    expect(r.xml).toContain('too &lt;salty&gt; &amp; cold')
    assertWellFormed(r.xml)
  })

  it('strips characters XML 1.0 forbids', () => {
    const r = buildTallyXml({ ledgers: { ...ledgers, party: 'Counter\u0000 Sales\u0008' }, days: [day()] })
    expect(r.xml).not.toMatch(/[\u0000-\u0008]/)
    expect(r.xml).toContain('<LEDGERNAME>Counter Sales</LEDGERNAME>')
  })

  it('is well-formed overall, with the request envelope Tally expects', () => {
    const { xml } = buildTallyXml({ company: 'Test Co', ledgers, days: [day(), day({ date: '2026-11-11' })] })
    assertWellFormed(xml)
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>')
    expect(xml).toContain('<REPORTNAME>Vouchers</REPORTNAME>')
    expect(xml).toContain('<SVCURRENTCOMPANY>Test Co</SVCURRENTCOMPANY>')
  })

  it('leaves the company out when none is given, rather than writing an empty one', () => {
    expect(buildTallyXml({ ledgers, days: [day()] }).xml).not.toContain('SVCURRENTCOMPANY')
    expect(buildTallyXml({ company: '  ', ledgers, days: [day()] }).xml).not.toContain('SVCURRENTCOMPANY')
  })
})

describe('closedBusinessDays', () => {
  // 2026-11-12 18:00 IST == 12:30 UTC
  const now = new Date('2026-11-12T12:30:00Z')

  it('returns whole finished café-local days and leaves today out', () => {
    // 9 Nov 00:00 IST = 8 Nov 18:30 UTC
    const days = closedBusinessDays('2026-11-08T18:30:00Z', now.toISOString(), 'Asia/Kolkata', now)
    expect(days.map((d) => d.date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11'])
    expect(days[0].from).toBe('2026-11-08T18:30:00.000Z')
    expect(days[0].to).toBe('2026-11-09T18:30:00.000Z')
  })

  it('never splits a day: each day starts exactly where the last one ended', () => {
    const days = closedBusinessDays('2026-10-01T00:00:00Z', '2026-11-12T00:00:00Z', 'Asia/Kolkata', now)
    for (let i = 1; i < days.length; i++) expect(days[i].from).toBe(days[i - 1].to)
  })

  it('snaps a start that is mid-day back to that day’s start', () => {
    const days = closedBusinessDays('2026-11-09T06:00:00Z', '2026-11-11T18:30:00Z', 'Asia/Kolkata', now)
    expect(days[0].date).toBe('2026-11-09')
  })

  it('returns nothing when the range is only today', () => {
    expect(closedBusinessDays('2026-11-11T18:30:00Z', now.toISOString(), 'Asia/Kolkata', now)).toEqual([])
  })

  it('stays contiguous across a daylight-saving change (a 25-hour day)', () => {
    const late = new Date('2026-11-10T12:00:00Z')
    const days = closedBusinessDays('2026-10-31T00:00:00Z', '2026-11-09T00:00:00Z', 'America/New_York', late)
    const dates = days.map((d) => d.date)
    expect(new Set(dates).size).toBe(dates.length) // no repeated date
    for (let i = 1; i < days.length; i++) expect(days[i].from).toBe(days[i - 1].to)
    const nov1 = days.find((d) => d.date === '2026-11-01')!
    expect((new Date(nov1.to).getTime() - new Date(nov1.from).getTime()) / 3600_000).toBe(25)
  })

  it('refuses a range wider than the cap', () => {
    expect(() => closedBusinessDays('2026-01-01T00:00:00Z', '2026-11-01T00:00:00Z', 'Asia/Kolkata', now)).toThrow(TallyExportError)
    expect(MAX_EXPORT_DAYS).toBe(92)
  })
})

describe('tallyFileName', () => {
  it('names the period so two exports never overwrite each other', () => {
    expect(tallyFileName('2026-11-01', '2026-11-10')).toBe('KhaoPiyo_Tally_GST_2026-11-01_to_2026-11-10.xml')
    expect(tallyFileName('2026-11-10', '2026-11-10')).toBe('KhaoPiyo_Tally_GST_2026-11-10.xml')
  })
})
