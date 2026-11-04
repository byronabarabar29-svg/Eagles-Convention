import { supabase, TABLES } from '../db.js'
import { hashPassword, verifyPassword } from '../utils/password.js'
import { generateReference, normalizeReference } from '../utils/reference.js'

const USER_COLUMNS =
    'id, full_name, username, contact_number, club_region, reference, created_at'

const PH_CONTACT = /^(09\d{9}|\+639\d{9}|0\d{6,10})$/
const USERNAME = /^[A-Za-z0-9._-]{2,32}$/

function text(value) {
    return typeof value === 'string' ? value.trim() : ''
}

/** Same normalization the frontend uses for name comparison. */
function nameKey(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Convert a database row (snake_case) into the API shape (camelCase). */
function toPublicUser(row) {
    if (!row) return null

    return {
        id: row.id,
        fullName: row.full_name,
        username: row.username,
        contactNumber: row.contact_number,
        clubRegion: row.club_region,
        reference: row.reference,
        createdAt: row.created_at,
    }
}

function isUniqueViolation(error) {
    return error?.code === '23505'
}

/**
 * POST /api/users/register
 * Body: { fullName, username?, contactNumber, clubRegion, password? }
 */
export const registerUser = async (req, res) => {
    const body = req.body ?? {}
    const fullName = text(body.fullName ?? body.full_name)
    const username = text(body.username)
    const contactNumber = text(body.contactNumber ?? body.contact_number)
    const clubRegion = text(body.clubRegion ?? body.club_region)
    const password = typeof body.password === 'string' ? body.password : ''

    const errors = []

    if (fullName.length < 2) {
        errors.push('fullName must be at least 2 characters.')
    }

    if (username && !USERNAME.test(username)) {
        errors.push('username must be 2-32 characters using letters, numbers, dot, underscore, or hyphen.')
    }

    if (!PH_CONTACT.test(contactNumber.replace(/[\s()-]/g, ''))) {
        errors.push('contactNumber must be a valid PH number, e.g. 09171234567.')
    }

    if (!clubRegion) {
        errors.push('clubRegion is required.')
    }

    // Password is optional so the current registration form keeps working.
    // When supplied it must be at least 8 characters.
    if (password && password.length < 8) {
        errors.push('password must be at least 8 characters.')
    }

    if (errors.length > 0) {
        return res.status(400).json({
            message: 'Invalid registration details.',
            errors,
        })
    }

    const passwordHash = password ? await hashPassword(password) : null

    // Reference numbers are random, but retry a few times on the rare collision.
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const reference = generateReference()

        const { data, error } = await supabase
            .from(TABLES.users)
            .insert({
                full_name: fullName,
                username: username || null,
                contact_number: contactNumber,
                club_region: clubRegion,
                reference,
                password_hash: passwordHash,
            })
            .select(USER_COLUMNS)
            .single()

        if (!error) {
            return res.status(201).json({
                message: 'Registration successful.',
                user: toPublicUser(data),
                reference: data.reference,
            })
        }

        if (isUniqueViolation(error)) {
            const detail = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()

            if (detail.includes('username')) {
                return res.status(409).json({
                    message: 'That username is already taken.',
                })
            }

            // Otherwise it was a reference collision — try again.
            continue
        }

        console.error('registerUser:', error)
        return res.status(500).json({
            message: 'Could not create the user.',
            detail: error.message,
        })
    }

    return res.status(500).json({
        message: 'Could not generate a unique reference number. Please try again.',
    })
}

/**
 * POST /api/users/login
 * Body: { reference, password }  — for accounts that set a password
 *    or: { reference, username }  — for passwordless accounts
 *    or: { reference, fullName }  — fallback for passwordless accounts
 *
 * The reference number is the primary credential. If the account has a
 * password, it must be supplied; otherwise the username (or full name) is
 * checked.
 */
export const loginUser = async (req, res) => {
    const body = req.body ?? {}
    const reference = normalizeReference(
        body.reference ?? body.referenceNumber ?? body.refNumber
    )
    const password = typeof body.password === 'string' ? body.password : ''
    const providedName = text(
        body.username ?? body.name ?? body.fullName ?? body.full_name ?? body.memberName
    )

    if (!reference) {
        return res.status(400).json({
            message: 'A valid reference number is required.',
        })
    }

    if (!password && !providedName) {
        return res.status(400).json({
            message: 'Provide a password, or the username registered with this reference.',
        })
    }

    const { data, error } = await supabase
        .from(TABLES.users)
        .select(`${USER_COLUMNS}, password_hash`)
        .eq('reference', reference)
        .maybeSingle()

    if (error) {
        console.error('loginUser:', error)
        return res.status(500).json({
            message: 'Could not sign in.',
            detail: error.message,
        })
    }

    // Use the same response for an unknown reference and a wrong password so
    // the endpoint does not reveal which reference numbers exist.
    if (!data) {
        return res.status(401).json({
            message: 'Invalid reference number or password.',
        })
    }

    if (data.password_hash) {
        const passwordMatches =
            Boolean(password) &&
            (await verifyPassword(password, data.password_hash))

        if (!passwordMatches) {
            return res.status(401).json({
                message: 'Invalid reference number or password.',
            })
        }
    } else {
        const nameMatches =
            nameKey(providedName) === nameKey(data.username) ||
            nameKey(providedName) === nameKey(data.full_name)

        if (!nameMatches) {
            return res.status(401).json({
                message: 'That reference number belongs to a different registrant.',
            })
        }
    }

    return res.status(200).json({
        message: 'Login successful.',
        user: toPublicUser(data),
    })
}

/**
 * GET /api/users/:reference
 * Returns the public profile for one registrant.
 */
export const getUserByReference = async (req, res) => {
    const reference = normalizeReference(req.params.reference)

    if (!reference) {
        return res.status(400).json({
            message: 'Invalid reference number.',
        })
    }

    const { data, error } = await supabase
        .from(TABLES.users)
        .select(USER_COLUMNS)
        .eq('reference', reference)
        .maybeSingle()

    if (error) {
        console.error('getUserByReference:', error)
        return res.status(500).json({
            message: 'Could not load the user.',
            detail: error.message,
        })
    }

    if (!data) {
        return res.status(404).json({ message: 'User not found.' })
    }

    return res.status(200).json({ user: toPublicUser(data) })
}
