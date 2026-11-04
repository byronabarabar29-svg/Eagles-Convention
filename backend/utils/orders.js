import { FEES } from './fees.js'

export const PAYMENT_STATUSES = Object.freeze(['pending', 'verified', 'rejected'])

/** EMC-LX3K9Q2AB-7F2D → the reference as members see it. */
export function prettyReference(value) {
    const key = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (key.length < 10) return key
    return `EMC-${key.slice(3, -4)}-${key.slice(-4)}`
}

/** Payment status → order status. No payment means the order is unpaid. */
export function orderStatusFor(payment) {
    return payment?.status ?? 'unpaid'
}

/**
 * Derive the orders a member owns. Orders are not stored separately: every
 * registrant has one registration order and one order per shirt reservation.
 */
export function buildOrders({ userId, reference, shirts = [], payment = null }) {
    const ref = prettyReference(reference)
    const status = orderStatusFor(payment)

    const orders = [
        {
            id: `registration:${userId}`,
            orderNo: `${ref}-01`,
            kind: 'registration',
            title: 'Convention Registration',
            subtitle: '3rd Eagles Mindanao Convention — delegate fee',
            qty: 1,
            unitPrice: FEES.registration,
            total: FEES.registration,
            status,
            size: null,
            nameOnShirt: null,
            shirtId: null,
        },
    ]

    const sortedShirts = [...shirts].sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
    )

    sortedShirts.forEach((shirt, index) => {
        const nameOnShirt = shirt.name_on_shirt ?? null

        orders.push({
            id: `shirt:${shirt.id}`,
            orderNo: `${ref}-${String(index + 2).padStart(2, '0')}`,
            kind: 'tshirt',
            title: `Convention T-Shirt — Size ${shirt.size}`,
            subtitle: nameOnShirt
                ? `Official convention shirt × ${shirt.qty} · Name in shirt: ${nameOnShirt}`
                : `Official convention shirt × ${shirt.qty}`,
            qty: shirt.qty,
            unitPrice: FEES.tshirt,
            total: FEES.tshirt * shirt.qty,
            status,
            size: shirt.size,
            nameOnShirt,
            shirtId: shirt.id,
        })
    })

    return orders
}

export function ordersTotal(orders = []) {
    return orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0)
}

/** Database payment row → API shape. Receipts are opt-in to keep lists small. */
export function toPublicPayment(row, { includeReceipt = false } = {}) {
    if (!row) return null

    const payment = {
        id: row.id,
        method: row.method,
        txnRef: row.txn_ref,
        txnDate: row.txn_date,
        amount: Number(row.amount ?? 0),
        status: row.status,
        note: row.note,
        submittedAt: row.submitted_at,
        verifiedAt: row.verified_at,
        verifiedBy: row.verified_by,
        hasReceipt: Boolean(row.receipt_image),
    }

    if (includeReceipt) {
        payment.receiptImage = row.receipt_image ?? null
    }

    return payment
}
