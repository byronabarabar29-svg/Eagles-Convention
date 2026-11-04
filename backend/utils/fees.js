/*
 * Convention fees. Keep these in sync with `FEES` in js/dashboard.js.
 * They live on the server so the amount stored with a payment cannot be
 * changed by the browser.
 */
export const FEES = Object.freeze({
    registration: 1500,
    tshirt: 350,
})
