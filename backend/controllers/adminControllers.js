import { supabase, TABLES } from '../db.js'
import { normalizeReference } from '../utils/reference.js'
import {
    buildOrders,
    ordersTotal,
    prettyReference,
    toPublicPayment,
} from '../utils/orders.js'

const USER_COLUMNS =
    'id, full_name, username, email, contact_number, club_region, reference, created_at'
const SHIRT_COLUMNS = 'id, user_id, size, name_on_shirt, qty, created_at'
const PAYMENT_COLUMNS =
    'id, user_id, method, txn_ref, txn_date, amount, receipt_image, status, note, submitted_at, verified_at, verified_by, updated_at'

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function text(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function isMissingTable(error) {
    return error?.code === 'PGRST205' || error?.code === '42P01'
}

function isMissingColumn(error) {
    return error?.code === '42703' || error?.code === 'PGRST204'
}

function schemaUpgradeMessage(error) {
    if (isMissingColumn(error)) {
        return 'The database is missing a newly added column. Re-run backend/sql/schema.sql (or `npm run db`) to apply the update.'
    }

    if (isMissingTable(error)) {
        return 'A required table is missing. Run backend/sql/schema.sql (or `npm run db`) to create the users, shirts, and payments tables.'
    }

    return null
}

function groupByUser(rows) {
    const map = new Map()

    for (const row of rows ?? []) {
        const list = map.get(row.user_id) ?? []
        list.push(row)
        map.set(row.user_id, list)
    }

    return map
}

function toAdminUser(user, shirts, payment, { includeReceipt = false } = {}) {
    const orders = buildOrders({
        userId: user.id,
        reference: user.reference,
        shirts,
        payment,
    })

    return {
        id: user.id,
        fullName: user.full_name,
        username: user.username,
        email: user.email,
        contactNumber: user.contact_number,
        clubRegion: user.club_region,
        reference: prettyReference(user.reference),
        rawReference: user.reference,
        createdAt: user.created_at,
        orders,
        orderCount: orders.length,
        ordersTotal: ordersTotal(orders),
        payment: toPublicPayment(payment, { includeReceipt }),
        status: payment?.status ?? 'unpaid',
    }
}

/**
 * GET /api/admin/session
 * Cheap endpoint the admin page uses to test a key before loading data.
 */
export const getAdminSession = (req, res) => {
    return res.status(200).json({ ok: true })
}

/**
 * GET /api/admin/users
 * Every member with their derived orders and payment summary. Receipt images
 * are excluded here and fetched only when a payment is opened for review.
 */
export const listAdminUsers = async (req, res) => {
    const [usersResult, shirtsResult, paymentsResult] = await Promise.all([
        supabase
            .from(TABLES.users)
            .select(USER_COLUMNS)
            .order('created_at', { ascending: false })
            .range(0, 4999),
        supabase
            .from(TABLES.shirts)
            .select(SHIRT_COLUMNS)
            .order('created_at', { ascending: true })
            .range(0, 4999),
        supabase
            .from(TABLES.payments)
            .select(PAYMENT_COLUMNS)
            .range(0, 4999),
    ])

    for (const result of [usersResult, shirtsResult, paymentsResult]) {
        if (!result.error) continue

        console.error('listAdminUsers:', result.error)

        const schemaMessage = schemaUpgradeMessage(result.error)
        if (schemaMessage) {
            return res.status(503).json({ message: schemaMessage })
        }

        return res.status(500).json({
            message: 'Could not load the admin data.',
            detail: result.error.message,
        })
    }

    const shirtsByUser = groupByUser(shirtsResult.data)
    const paymentsByUser = new Map(
        (paymentsResult.data ?? []).map((payment) => [payment.user_id, payment])
    )

    const users = (usersResult.data ?? []).map((user) =>
        toAdminUser(
            user,
            shirtsByUser.get(user.id) ?? [],
            paymentsByUser.get(user.id) ?? null
        )
    )

    return res.status(200).json({
        users,
        generatedAt: new Date().toISOString(),
    })
}

/**
 * GET /api/admin/users/:reference
 * One member's profile, orders and full payment (including the receipt).
 */
export const getAdminUser = async (req, res) => {
    const reference = normalizeReference(req.params.reference)

    if (!reference) {
        return res.status(400).json({ message: 'Invalid reference number.' })
    }

    const userResult = await supabase
        .from(TABLES.users)
        .select(USER_COLUMNS)
        .eq('reference', reference)
        .maybeSingle()

    if (userResult.error) {
        console.error('getAdminUser:', userResult.error)
        return res.status(500).json({
            message: 'Could not load the member.',
            detail: userResult.error.message,
        })
    }

    if (!userResult.data) {
        return res.status(404).json({ message: 'Member not found.' })
    }

    const user = userResult.data

    const [shirtsResult, paymentResult] = await Promise.all([
        supabase
            .from(TABLES.shirts)
            .select(SHIRT_COLUMNS)
            .eq('user_id', user.id)
            .order('created_at', { ascending: true }),
        supabase
            .from(TABLES.payments)
            .select(PAYMENT_COLUMNS)
            .eq('user_id', user.id)
            .maybeSingle(),
    ])

    if (shirtsResult.error || paymentResult.error) {
        const error = shirtsResult.error ?? paymentResult.error
        console.error('getAdminUser (details):', error)

        const schemaMessage = schemaUpgradeMessage(error)
        if (schemaMessage) {
            return res.status(503).json({ message: schemaMessage })
        }

        return res.status(500).json({
            message: 'Could not load the member details.',
            detail: error.message,
        })
    }

    return res.status(200).json({
        user: toAdminUser(
            user,
            shirtsResult.data ?? [],
            paymentResult.data ?? null,
            { includeReceipt: true }
        ),
    })
}

/**
 * PATCH /api/admin/payments/:id/verify
 * Body: { status: 'verified' | 'rejected' | 'pending', note? }
 */
export const verifyPayment = async (req, res) => {
    const id = String(req.params.id ?? '')
    const body = req.body ?? {}
    const status = text(body.status).toLowerCase()
    const note = text(body.note)

    if (!UUID.test(id)) {
        return res.status(400).json({ message: 'Invalid payment id.' })
    }

    if (!['verified', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({
            message: 'status must be verified, rejected, or pending.',
        })
    }

    if (note.length > 500) {
        return res.status(400).json({
            message: 'note must be 500 characters or fewer.',
        })
    }

    const now = new Date().toISOString()
    const updates = {
        status,
        note: note || null,
        verified_at: status === 'pending' ? null : now,
        verified_by: status === 'pending' ? null : 'admin',
        updated_at: now,
    }

    const { data, error } = await supabase
        .from(TABLES.payments)
        .update(updates)
        .eq('id', id)
        .select(PAYMENT_COLUMNS)
        .maybeSingle()

    if (error) {
        console.error('verifyPayment:', error)

        if (isMissingTable(error)) {
            return res.status(503).json({
                message:
                    'A required table is missing. Run backend/sql/schema.sql (or `npm run db`) to create the users, shirts, and payments tables.',
            })
        }

        return res.status(500).json({
            message: 'Could not update the payment.',
            detail: error.message,
        })
    }

    if (!data) {
        return res.status(404).json({ message: 'Payment not found.' })
    }

    const label = status === 'verified' ? 'verified' : status === 'rejected' ? 'rejected' : 'returned to pending'

    return res.status(200).json({
        message: `Payment ${label}.`,
        payment: toPublicPayment(data),
    })
}
