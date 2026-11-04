import { randomBytes } from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const REFERENCE_KEY = /^EMC[0-9A-Z]{7,16}$/

/**
 * Create a reference number in the same format the frontend uses:
 * EMC-<timestamp base36>-<4 random characters>
 */
export function generateReference() {
    const stamp = Date.now().toString(36).toUpperCase()
    const bytes = randomBytes(4)

    let suffix = ''
    for (const byte of bytes) {
        suffix += ALPHABET[byte % ALPHABET.length]
    }

    return `EMC-${stamp}-${suffix}`
}

/**
 * Turn any casing/hyphen variant into the canonical reference format.
 * Returns null when the value is not a valid reference.
 */
export function normalizeReference(value) {
    const key = String(value ?? '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')

    if (!REFERENCE_KEY.test(key)) return null

    const middle = key.slice(3, -4)
    const suffix = key.slice(-4)

    return `EMC-${middle}-${suffix}`
}
