import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

// Legal + privacy pages. The content below describes what KhaoPiyo ACTUALLY
// does — it was written from the data inventory in PRIVACY_COMPLIANCE_AUDIT.md
// (what is collected, where it is stored, which processors touch it).
//
// Deliberately absent: any claim of being "100% secure", "fully DPDP
// compliant", or "we never share your data" (infrastructure providers
// necessarily process it). Items needing professional review are marked
// inline rather than asserted as settled compliance.
//
// OPERATOR ACTION REQUIRED: CONTACT_EMAIL / GRIEVANCE_* below must be real,
// monitored mailboxes before launch.
const CONTACT_EMAIL = 'privacy@ventron.in'
const GRIEVANCE_NAME = 'Grievance Officer, Ventron'
const GRIEVANCE_EMAIL = 'grievance@ventron.in'
const OPERATOR = 'Ventron ("KhaoPiyo", "we", "us")'

type Section = { h: string; p?: string[]; list?: string[] }
type Doc = { title: string; updated: string; intro: string; sections: Section[]; review?: string }

const docs: Record<string, Doc> = {
  privacy: {
    title: 'Privacy Policy',
    updated: '24 July 2026',
    intro:
      `${OPERATOR} builds KhaoPiyo, software that cafés and restaurants use to take orders and bill customers. This policy explains what data the product handles, why, who else processes it, and how to exercise your rights.`,
    sections: [
      {
        h: 'Who controls your data',
        p: [
          'When you order at a café using KhaoPiyo, the café decides what to collect and why — the café is the data fiduciary. KhaoPiyo processes that data on the café\'s instructions as its processor.',
          'For café owner and staff accounts (login email, role), KhaoPiyo is itself the fiduciary.',
          'If you want your order data removed, you may contact either the café or us — see “Your rights”.',
        ],
      },
      {
        h: 'What we collect',
        list: [
          'Customer: phone number (only if you provide it), name (optional), your order contents, amounts, and order history at that café.',
          'Verification: a one-time code, stored only as a cryptographic hash, and a session token so “My Orders” stays unlocked on your device.',
          'Café owner/staff: name, email, role, and actions taken in the product (audit log).',
          'Payments: the payment method, amount, and — for online payments — the payment reference returned by the gateway. We never receive or store your card number, UPI PIN, or bank credentials.',
        ],
      },
      {
        h: 'What we do not collect',
        p: [
          'We do not store your location, device fingerprint, or browsing behaviour, and we do not use advertising or cross-site tracking cookies. Our infrastructure providers process technical request data (such as IP address) to deliver and secure the service.',
        ],
      },
      {
        h: 'Why we collect it',
        list: [
          'To send your order to the kitchen and produce a correct bill and tax invoice.',
          'To let you see your own past orders and reorder.',
          'To let the café run its business — sales, refunds, and statutory GST records.',
          'To keep the service secure and investigate misuse.',
        ],
      },
      {
        h: 'Who else processes your data',
        p: ['We use these providers. They process data to run the service; they are not permitted to use it for their own purposes:'],
        list: [
          'Supabase — database, authentication, and file storage.',
          'Vercel — application hosting and delivery.',
          'Razorpay — only if your café has enabled online payments; it processes the payment itself under its own policies.',
          'An SMS provider (MSG91 or Twilio) — only if your café has enabled SMS receipts or phone verification.',
        ],
      },
      {
        h: 'How long we keep it',
        p: [
          'Order and invoice records are retained by the café for as long as it needs them, including any statutory tax-record period. Verification codes expire within minutes; verification sessions expire after 90 days.',
          'We are still finalising standard retention limits. Until then, you may request erasure at any time.',
        ],
      },
      {
        h: 'How it is protected',
        p: [
          'Data is encrypted in transit. Every café\'s data is isolated at the database level by row-level security, so one café cannot read another\'s. Payment gateway secrets are encrypted at rest. Access to financial records is restricted and audited.',
          'No system is completely secure, and we do not claim otherwise. If a breach affects your data, we will act on it and notify affected parties and authorities as required.',
        ],
      },
      {
        h: 'Your rights',
        p: [
          'You may ask us to give you a copy of your data, correct it, or delete it. Use the data request page or write to us.',
        ],
        list: [
          `Data requests: /legal/data-request`,
          `Email: ${CONTACT_EMAIL}`,
          `Grievances: ${GRIEVANCE_NAME} — ${GRIEVANCE_EMAIL}`,
        ],
      },
      {
        h: 'Children',
        p: ['KhaoPiyo is intended for use by café staff and by customers placing orders. It is not directed at children.'],
      },
      {
        h: 'Changes',
        p: ['If this policy changes materially we will update the date above and, where appropriate, notify café accounts.'],
      },
    ],
    review: 'This notice describes our actual processing. Its sufficiency under the Digital Personal Data Protection Act, 2023 and its rules — including retention periods and any breach-notification timelines — should be confirmed with a qualified Indian data-protection adviser before commercial launch.',
  },

  terms: {
    title: 'Terms of Service',
    updated: '24 July 2026',
    intro: `These terms govern use of KhaoPiyo, provided by ${OPERATOR}.`,
    sections: [
      { h: 'The service', p: ['KhaoPiyo is software for taking orders, billing, and managing a café. We provide the software; we do not sell food, set prices, or operate any café.'] },
      { h: 'Accounts and authorised users', p: ['A café account is controlled by its owner, who may invite staff and assign roles. The owner is responsible for who they grant access to and for actions taken under those accounts. Keep credentials confidential.'] },
      { h: 'The café\'s responsibilities', list: [
        'The accuracy of its menu, prices, taxes, and any claims about food (including allergens).',
        'Fulfilling customer orders and handling customer complaints and refunds.',
        'Its own statutory obligations, including GST registration, correct tax rates, and invoice retention.',
        'Lawful handling of its customers\' personal data.',
      ] },
      { h: 'Acceptable use', list: [
        'Do not attempt to access another café\'s data, probe or bypass access controls, or disrupt the service.',
        'Do not upload unlawful content or use the service to send unsolicited messages.',
        'Do not resell or redistribute the service without our written agreement.',
      ] },
      { h: 'Payments to cafés', p: ['If a café enables online payments, that transaction is processed by the payment gateway under the café\'s own gateway account and that gateway\'s terms. Money settles directly to the café. We are not a party to the payment and do not hold customer funds.'] },
      { h: 'Subscriptions, trials and taxes', p: ['Fees, trial length, billing cycle, and applicable taxes are those stated at sign-up or in a separate written agreement. Where no fee has been agreed, the service is provided without charge and without any service-level commitment.'] },
      { h: 'Availability', p: ['We aim to keep the service available but do not guarantee uninterrupted operation. The service depends on third-party infrastructure. Cafés should be able to continue serving customers if the service is temporarily unavailable.'] },
      { h: 'Data', p: ['A café\'s business and customer data belongs to that café. We process it to provide the service, as described in the Privacy Policy. On account closure we will delete or return data on request, subject to any legal retention requirement.'] },
      { h: 'Intellectual property', p: ['The software, interface, and brand remain ours. Nothing here transfers ownership of them.'] },
      { h: 'Suspension and termination', p: ['We may suspend an account for non-payment, unlawful use, or activity that threatens the security or integrity of the service. A café may stop using the service at any time.'] },
      { h: 'Warranties and liability', p: ['The service is provided "as is" to the maximum extent permitted by law. Limits and exclusions of liability must be set out in a form that is enforceable in the applicable jurisdiction — this section is expressly flagged for legal review.'] },
      { h: 'Governing law', p: ['Governing law and jurisdiction are to be confirmed in the final executed terms.'] },
      { h: 'Contact', p: [`Questions about these terms: ${CONTACT_EMAIL}`] },
    ],
    review: 'These terms are a good-faith description of how the product actually works. They are NOT a substitute for legal advice. Liability limitation, indemnity, warranty disclaimers, governing law, and consumer-law compliance must be drafted or reviewed by a qualified Indian lawyer before the product is sold commercially.',
  },

  refunds: {
    title: 'Refunds & Cancellations',
    updated: '24 July 2026',
    intro: 'There are two different things people mean by “refund” here. This page separates them.',
    sections: [
      { h: 'Refunds for a food order', p: [
        'Your order is a purchase from the café, not from KhaoPiyo. The café decides whether to cancel or refund an order, and it is responsible for making that refund.',
        'Please speak to the café. If the café issues a refund, it is recorded against your bill and, where the payment was made online, returned through the original payment method by the café\'s payment gateway. Bank timelines apply.',
      ] },
      { h: 'Refunds for a KhaoPiyo subscription', p: [
        'If a café pays for KhaoPiyo, refund and cancellation terms are those stated at sign-up or in its written agreement. A café may cancel at any time; cancellation stops future billing.',
        `For subscription billing questions, contact ${CONTACT_EMAIL}.`,
      ] },
    ],
    review: 'If subscriptions are billed to consumers or small businesses in India, confirm the required cancellation/refund disclosures with a qualified adviser.',
  },

  cookies: {
    title: 'Cookies & Local Storage',
    updated: '24 July 2026',
    intro: 'KhaoPiyo uses only what it needs to keep you signed in and your cart intact.',
    sections: [
      { h: 'What we use', list: [
        'Authentication cookies — keep a café owner or staff member signed in. Essential.',
        'A verification session token — keeps “My Orders” unlocked on your device after you verify your phone. Essential to that feature.',
        'Local storage — holds your in-progress cart so a refresh does not lose your order.',
      ] },
      { h: 'What we do not use', p: ['No advertising cookies, no cross-site tracking, no third-party analytics profiling.'] },
      { h: 'Control', p: ['You can clear cookies and local storage in your browser at any time. Doing so signs you out and clears an in-progress cart.'] },
    ],
  },

  'data-request': {
    title: 'Data Request — access, correction, deletion',
    updated: '24 July 2026',
    intro: 'Use this page to ask for a copy of your data, to correct it, or to have it deleted.',
    sections: [
      { h: 'If you are a café customer', p: [
        'The café you ordered from controls your order data. The quickest route is usually to ask the café directly — they can remove your details from their customer list.',
        `You can also write to us and we will act on it with the café: ${CONTACT_EMAIL}.`,
      ] },
      { h: 'If you are a café owner or staff member', p: [
        `Write to ${CONTACT_EMAIL} from the email address on your account.`,
      ] },
      { h: 'What to include', list: [
        'What you want: a copy of your data, a correction, or deletion.',
        'The café name (and approximate date of your visit, if you are a customer).',
        'The phone number or email the data is held under, so we can locate it.',
      ] },
      { h: 'What happens next', p: [
        'We will verify that the request genuinely comes from you or your authorised representative — this protects your data from someone else requesting it.',
        'We will confirm receipt and tell you what we have done. Some records must be retained where the law requires it (for example, tax invoices); we will tell you if that applies.',
      ] },
      { h: 'If you are unhappy with the outcome', p: [
        `Contact ${GRIEVANCE_NAME} at ${GRIEVANCE_EMAIL}. You may also have the right to complain to the relevant data-protection authority.`,
      ] },
    ],
    review: 'Statutory response deadlines and identity-verification standards for data-principal requests should be confirmed with a qualified Indian data-protection adviser.',
  },
}

export function generateStaticParams() {
  return Object.keys(docs).map((doc) => ({ doc }))
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params
  return { title: docs[doc]?.title ?? 'Legal' }
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params
  const d = docs[doc]
  if (!d) notFound()

  const others = Object.entries(docs).filter(([k]) => k !== doc)

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-6">
          <Link href="/" className="flex items-center">
            <Image src="/logo-wordmark.png" alt="KhaoPiyo" width={900} height={311} className="h-7 w-auto" />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{d.title}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Last updated: {d.updated}</p>
        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{d.intro}</p>

        {d.sections.map((s) => (
          <section key={s.h} className="mt-8">
            <h2 className="text-[17px] font-semibold tracking-tight text-foreground">{s.h}</h2>
            {s.p?.map((para, i) => (
              <p key={i} className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{para}</p>
            ))}
            {s.list && (
              <ul className="mt-2 space-y-1.5">
                {s.list.map((li, i) => (
                  <li key={i} className="flex gap-2 text-[14.5px] leading-relaxed text-muted-foreground">
                    <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                    <span>{li}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        {d.review && (
          <div className="mt-10 rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3 text-[13px] leading-relaxed text-warning">
            <strong className="font-semibold">Requires professional review.</strong> {d.review}
          </div>
        )}

        <nav className="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-6 text-[13px]">
          {others.map(([k, v]) => (
            <Link key={k} href={`/legal/${k}`} className="text-primary hover:underline">{v.title}</Link>
          ))}
        </nav>
      </main>
    </div>
  )
}
