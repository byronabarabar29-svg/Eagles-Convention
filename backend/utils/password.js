import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const KEY_LENGTH = 64

/**
 * Hash a plain-text password with a random salt.
 * Stored format: scrypt$<salt-hex>$<derived-key-hex>
 */
export async function hashPassword(password) {
    const salt = randomBytes(16).toString('hex')
    const derivedKey = await scryptAsync(password, salt, KEY_LENGTH)
    return `scrypt$${salt}$${derivedKey.toString('hex')}`
}

/**
 * Compare a plain-text password against a stored scrypt hash.
 */
export async function verifyPassword(password, storedHash) {
    if (typeof storedHash !== 'string') return false

    const [scheme, salt, key] = storedHash.split('$')
    if (scheme !== 'scrypt' || !salt || !key) return false

    const expected = Buffer.from(key, 'hex')
    const actual = await scryptAsync(password, salt, expected.length)

    return (
        expected.length === actual.length &&
        timingSafeEqual(expected, actual)
    )
}
