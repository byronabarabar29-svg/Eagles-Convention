import { timingSafeEqual } from 'node:crypto'

/*
 * Admin endpoints are protected by a shared key from the root .env:
 *
 *   ADMIN_KEY=some-long-random-value
 *
 * The browser sends it as the `X-Admin-Key` header. Without ADMIN_KEY the
 * endpoints stay disabled instead of being accidentally public.
 */
export function requireAdmin(req, res, next) {
    const expected = process.env.ADMIN_KEY

    if (!expected) {
        return res.status(503).json({
            message:
                'Admin access is not configured. Add ADMIN_KEY to the root .env file and restart the server.',
        })
    }

    const provided = String(req.get('x-admin-key') ?? '')
    const expectedBuffer = Buffer.from(expected)
    const providedBuffer = Buffer.from(provided)

    const matches =
        providedBuffer.length === expectedBuffer.length &&
        timingSafeEqual(providedBuffer, expectedBuffer)

    if (!matches) {
        return res.status(401).json({ message: 'Invalid admin key.' })
    }

    return next()
}
