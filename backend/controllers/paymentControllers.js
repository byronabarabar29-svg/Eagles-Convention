import { supabase, TABLES } from '../db.js'
import { FEES } from '../utils/fees.js'
import { normalizeReference } from '../utils/reference.js'
import { toPublicPayment } from '../utils/orders.js'

const PAYMENT_COLUMNS =
    'id, user_id, method, txn_ref, txn_date, amount, receipt_image, status, note, submitted_at, verified_at, verified_by, updated_at'

const METHODS = ['GCash', 'Bank Transfer', 'Cash']
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const RECEIPT_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i
const MAX_RECEIPT_CHARS = 700_000

function text(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function isValidDate(value) {
    if (!DATE_ONLY.test(value)) return false
    const date = new Date(`${value}T00:00:00Z`)
    return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    )
}

function isMissingTable(error) {
    return error?.code === 'PGRST205' || error?.code === '42P01'
}

function missingSchemaResponse(res) {
    return res.status(503).json({
        message:
            'A required table is missing. Run backend/sql/schema.sql (or `npm run db`) to create the users, shirts, and payments tables.',
    })
}

async function findUserByReference(referenceValue) {
    const reference = normalizeReference(referenceValue)
    if (!reference) return null

    const { data, error } = await supabase
        .from(TABLES.users)
        .select('id, reference')
        .eq('reference', reference)
        .maybeSingle()

    if (error) throw error
    return data ?? null
}

/** Registration fee + every shirt reservation. Never trust a client amount. */
async function expectedAmountFor(userId) {
    const { data, error } = await supabase
        .from(TABLES.shirts)
        .select('qty')
        .eq('user_id', userId)

    if (error) throw error

    const shirts = (data ?? []).reduce(
        (sum, shirt) => sum + (Number(shirt.qty) || 0) * FEES.tshirt,
        0
    )

    return FEES.registration + shirts
}

/**
 * POST /api/payments
 * Body: { reference, method, txnRef?, txnDate, receiptImage? }
 *
 * One payment covers all of a member's orders, so this upserts the single
 * payment row for the member. Re-submitting always puts it back in the
 * "pending" queue for the secretariat to verify again.
 */
export const submitPayment = async (req, res) => {
    const body = req.body ?? {}
    const method = text(body.method)
    const txnRef = text(body.txnRef ?? body.txn_ref)
    const txnDate = text(body.txnDate ?? body.txn_date)
    const receiptImage = text(body.receiptImage ?? body.receipt_image)

    const errors = []

    if (!METHODS.includes(method)) {
        errors.push(`method must be one of: ${METHODS.join(', ')}.`)
    }

    if (!isValidDate(txnDate)) {
        errors.push('txnDate must be a valid date in YYYY-MM-DD format.')
    } else if (txnDate > new Date().toISOString().slice(0, 10)) {
        errors.push('txnDate cannot be in the future.')
    }

    if (method !== 'Cash') {
        if (txnRef.length < 2) {
            errors.push('txnRef is required for GCash and bank transfers.')
        } else if (txnRef.length > 60) {
            errors.push('txnRef must be 60 characters or fewer.')
        }
    }

    if (receiptImage) {
        if (!RECEIPT_DATA_URL.test(receiptImage)) {
            errors.push('receiptImage must be a base64 image data URL.')
        } else if (receiptImage.length > MAX_RECEIPT_CHARS) {
            errors.push('receiptImage is too large. Please upload a smaller screenshot.')
        }
    }

    if (errors.length > 0) {
        return res.status(400).json({
            message: 'Invalid payment details.',
            errors,
        })
    }

    let user
    try {
        user = await findUserByReference(body.reference)
    } catch (error) {
        console.error('submitPayment (user lookup):', error)
        if (isMissingTable(error)) return missingSchemaResponse(res)
        return res.status(500).json({
            message: 'Could not look up the member.',
            detail: error.message,
        })
    }

    if (!user) {
        return res.status(404).json({ message: 'Member not found.' })
    }

    let amount
    try {
        amount = await expectedAmountFor(user.id)
    } catch (error) {
        console.error('submitPayment (amount):', error)
        if (isMissingTable(error)) return missingSchemaResponse(res)
        return res.status(500).json({
            message: 'Could not calculate the amount due.',
            detail: error.message,
        })
    }

    const now = new Date().toISOString()

    const payload = {
        user_id: user.id,
        method,
        txn_ref: method === 'Cash' ? null : txnRef,
        txn_date: txnDate,
        amount,
        receipt_image: receiptImage || null,
        status: 'pending',
        note: null,
        submitted_at: now,
        verified_at: null,
        verified_by: null,
        updated_at: now,
    }

    const { data, error } = await supabase
        .from(TABLES.payments)
        .upsert(payload, { onConflict: 'user_id' })
        .select(PAYMENT_COLUMNS)
        .single()

    if (error) {
        console.error('submitPayment:', error)
        if (isMissingTable(error)) return missingSchemaResponse(res)
        return res.status(500).json({
            message: 'Could not save the payment details.',
            detail: error.message,
        })
    }

    return res.status(200).json({
        message: 'Payment details saved. The secretariat will verify them.',
        payment: toPublicPayment(data, { includeReceipt: true }),
    })
}

/**
 * GET /api/payments?reference=EMC-XXXXXXXX-XXXX
 * Returns the member's current payment (or null when nothing is submitted).
 */
export const getPaymentByReference = async (req, res) => {
    let user
    try {
        user = await findUserByReference(req.query.reference)
    } catch (error) {
        console.error('getPaymentByReference (user lookup):', error)
        if (isMissingTable(error)) return missingSchemaResponse(res)
        return res.status(500).json({
            message: 'Could not look up the member.',
            detail: error.message,
        })
    }

    if (!user) {
        return res.status(404).json({ message: 'Member not found.' })
    }

    const { data, error } = await supabase
        .from(TABLES.payments)
        .select(PAYMENT_COLUMNS)
        .eq('user_id', user.id)
        .maybeSingle()

    if (error) {
        console.error('getPaymentByReference:', error)
        if (isMissingTable(error)) return missingSchemaResponse(res)
        return res.status(500).json({
            message: 'Could not load the payment details.',
            detail: error.message,
        })
    }

    return res.status(200).json({
        payment: toPublicPayment(data, { includeReceipt: true }),
    })
}
