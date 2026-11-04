import { supabase, TABLES } from '../db.js'
import { normalizeReference } from '../utils/reference.js'

const SHIRT_COLUMNS = 'id, user_id, size, qty, created_at'
const VALID_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function toPublicShirt(row) {
    if (!row) return null

    return {
        id: row.id,
        userId: row.user_id,
        size: row.size,
        qty: row.qty,
        createdAt: row.created_at,
    }
}

function parseQuantity(value) {
    const qty = Number(value ?? 1)
    return Number.isInteger(qty) && qty >= 1 && qty <= 10 ? qty : null
}

/**
 * Find the users.id for a reference number.
 * Returns { id } on success, null when the user does not exist.
 */
async function findUserIdByReference(referenceValue) {
    const reference = normalizeReference(referenceValue)
    if (!reference) return null

    const { data, error } = await supabase
        .from(TABLES.users)
        .select('id')
        .eq('reference', reference)
        .maybeSingle()

    if (error) throw error
    return data?.id ?? null
}

/**
 * POST /api/shirts
 * Body: { userId } or { reference }, plus { size, qty }
 */
export const registerShirt = async (req, res) => {
    const body = req.body ?? {}
    const size = String(body.size ?? body.shirtSize ?? '').trim().toUpperCase()
    const qty = parseQuantity(body.qty ?? body.quantity)

    let userId = body.userId ?? body.user_id ?? null

    if (!VALID_SIZES.includes(size)) {
        return res.status(400).json({
            message: `size must be one of: ${VALID_SIZES.join(', ')}.`,
        })
    }

    if (qty === null) {
        return res.status(400).json({
            message: 'qty must be a whole number between 1 and 10.',
        })
    }

    if (userId && !UUID.test(String(userId))) {
        return res.status(400).json({ message: 'userId is not a valid UUID.' })
    }

    if (!userId) {
        if (!body.reference) {
            return res.status(400).json({
                message: 'Either userId or reference is required.',
            })
        }

        try {
            userId = await findUserIdByReference(body.reference)
        } catch (error) {
            console.error('registerShirt (user lookup):', error)
            return res.status(500).json({
                message: 'Could not look up the user.',
                detail: error.message,
            })
        }

        if (!userId) {
            return res.status(404).json({ message: 'User not found.' })
        }
    }

    const { data, error } = await supabase
        .from(TABLES.shirts)
        .insert({ user_id: userId, size, qty })
        .select(SHIRT_COLUMNS)
        .single()

    if (error) {
        console.error('registerShirt:', error)

        if (error.code === '23503') {
            return res.status(404).json({ message: 'User not found.' })
        }

        return res.status(500).json({
            message: 'Could not save the shirt reservation.',
            detail: error.message,
        })
    }

    return res.status(201).json({
        message: 'Shirt reservation saved.',
        shirt: toPublicShirt(data),
    })
}

/**
 * GET /api/shirts?userId=<uuid>
 * GET /api/shirts?reference=EMC-XXXXXXXX-XXXX
 */
export const getShirts = async (req, res) => {
    let userId = req.query.userId ?? req.query.user_id ?? null
    const reference = req.query.reference ?? null

    if (!userId && !reference) {
        return res.status(400).json({
            message: 'Provide either a userId or a reference query parameter.',
        })
    }

    if (userId && !UUID.test(String(userId))) {
        return res.status(400).json({ message: 'userId is not a valid UUID.' })
    }

    if (!userId) {
        try {
            userId = await findUserIdByReference(reference)
        } catch (error) {
            console.error('getShirts (user lookup):', error)
            return res.status(500).json({
                message: 'Could not look up the user.',
                detail: error.message,
            })
        }

        if (!userId) {
            return res.status(404).json({ message: 'User not found.' })
        }
    }

    const { data, error } = await supabase
        .from(TABLES.shirts)
        .select(SHIRT_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

    if (error) {
        console.error('getShirts:', error)
        return res.status(500).json({
            message: 'Could not load the shirts.',
            detail: error.message,
        })
    }

    return res.status(200).json({
        shirts: data.map(toPublicShirt),
    })
}

/**
 * PATCH /api/shirts/:id
 * Body: { size?, qty? }
 */
export const updateShirt = async (req, res) => {
    const body = req.body ?? {}
    const updates = {}

    if (body.size !== undefined || body.shirtSize !== undefined) {
        const size = String(body.size ?? body.shirtSize).trim().toUpperCase()

        if (!VALID_SIZES.includes(size)) {
            return res.status(400).json({
                message: `size must be one of: ${VALID_SIZES.join(', ')}.`,
            })
        }

        updates.size = size
    }

    if (body.qty !== undefined || body.quantity !== undefined) {
        const qty = parseQuantity(body.qty ?? body.quantity)

        if (qty === null) {
            return res.status(400).json({
                message: 'qty must be a whole number between 1 and 10.',
            })
        }

        updates.qty = qty
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({
            message: 'Provide at least one field to update: size or qty.',
        })
    }

    const { data, error } = await supabase
        .from(TABLES.shirts)
        .update(updates)
        .eq('id', req.params.id)
        .select(SHIRT_COLUMNS)
        .maybeSingle()

    if (error) {
        console.error('updateShirt:', error)
        return res.status(500).json({
            message: 'Could not update the shirt reservation.',
            detail: error.message,
        })
    }

    if (!data) {
        return res.status(404).json({ message: 'Shirt reservation not found.' })
    }

    return res.status(200).json({
        message: 'Shirt reservation updated.',
        shirt: toPublicShirt(data),
    })
}

/**
 * DELETE /api/shirts/:id
 */
export const deleteShirt = async (req, res) => {
    const { data, error } = await supabase
        .from(TABLES.shirts)
        .delete()
        .eq('id', req.params.id)
        .select('id')
        .maybeSingle()

    if (error) {
        console.error('deleteShirt:', error)
        return res.status(500).json({
            message: 'Could not delete the shirt reservation.',
            detail: error.message,
        })
    }

    if (!data) {
        return res.status(404).json({ message: 'Shirt reservation not found.' })
    }

    return res.status(200).json({ message: 'Shirt reservation deleted.' })
}
