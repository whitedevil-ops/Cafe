// Resolves a receipt's payment state into exactly one of five states the
// bill's stamp/badge can show — driven entirely by server data
// (orders.payment_status + payments[].status), never guessed from the
// frontend. "Failed" is real: payments.status has a genuine 'failed' value
// (0045's check constraint) for a payment attempt (e.g. a lapsed Razorpay
// checkout) that never became a captured payment — this only shows once
// there truly is a failed attempt and nothing has actually been paid yet.

export type ReceiptPaymentState = 'paid' | 'partial' | 'failed' | 'unpaid' | 'refunded'

export type ReceiptPayment = { method: string; amount: number; reference: string | null; status: string; provider: string | null; created_at: string }

export function resolvePaymentState(orderPaymentStatus: string, payments: ReceiptPayment[]): ReceiptPaymentState {
  if (orderPaymentStatus === 'refunded') return 'refunded'
  if (orderPaymentStatus === 'paid') return 'paid'
  if (orderPaymentStatus === 'partial') return 'partial'
  // Still unpaid overall — distinguish "nobody's tried yet" from "the last
  // attempt failed", using whichever payment row is most recent.
  const latest = payments[payments.length - 1]
  if (latest?.status === 'failed') return 'failed'
  return 'unpaid'
}

export const RECEIPT_STATE_LABEL: Record<ReceiptPaymentState, string> = {
  paid: 'PAID',
  partial: 'PARTIALLY PAID',
  failed: 'PAYMENT FAILED',
  unpaid: 'UNPAID',
  refunded: 'REFUNDED',
}

export function methodLabel(method: string | null): string {
  switch (method) {
    case 'card': return 'Card'
    case 'cash': return 'Cash'
    case 'upi': return 'UPI'
    case 'split': return 'Split payment'
    default: return 'Pay at counter'
  }
}
