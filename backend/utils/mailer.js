import nodemailer from 'nodemailer'

import { FEES } from './fees.js'

/*
 * Registration confirmation email.
 *
 * Two delivery methods are supported. The first one that is configured wins:
 *
 *  1. Resend HTTP API (works on Render and other hosts that block SMTP)
 *       RESEND_API_KEY  API key from https://resend.com
 *
 *  2. SMTP (Gmail, Zoho, SendGrid SMTP, your own mail server, …)
 *       SMTP_HOST       e.g. smtp.gmail.com / smtp.zoho.com / smtp.sendgrid.net
 *       SMTP_PORT       587 (STARTTLS) or 465 (SSL)
 *       SMTP_SECURE     "true" for port 465, otherwise "false"
 *       SMTP_USER       SMTP username (often the sender address)
 *       SMTP_PASS       SMTP password / app password / API key
 *
 * Shared settings:
 *       MAIL_FROM       From header, e.g. "Eagles <secretariat@eagles.org.ph>"
 *       PUBLIC_SITE_URL optional, used for the login link in the email
 *
 * When neither delivery method is configured the rest of the app still works;
 * the server logs that no email was sent instead of failing the registration.
 */

const MONEY = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
})

function text(value) {
    return typeof value === 'string' ? value.trim() : ''
}

/** Read mail settings lazily so dotenv has always loaded first. */
function mailConfig() {
    const resendApiKey = text(process.env.RESEND_API_KEY)
    const host = text(process.env.SMTP_HOST)
    const port = Number(process.env.SMTP_PORT) || 587
    const secure =
        text(process.env.SMTP_SECURE).toLowerCase() === 'true' || port === 465
    const user = text(process.env.SMTP_USER)
    const pass = text(process.env.SMTP_PASS)
    const provider = resendApiKey ? 'resend' : host ? 'smtp' : null
    const from =
        text(process.env.MAIL_FROM) ||
        (provider === 'resend'
            ? 'Eagles Convention <onboarding@resend.dev>'
            : user
                ? `Eagles Convention <${user}>`
                : 'Eagles Convention <no-reply@eagles.org.ph>')
    const siteUrl = text(process.env.PUBLIC_SITE_URL).replace(/\/+$/, '')

    return {
        configured: Boolean(provider),
        provider,
        resendApiKey,
        host,
        port,
        secure,
        user,
        pass,
        from,
        siteUrl,
    }
}

export function isMailerConfigured() {
    return mailConfig().configured
}

/** { configured, provider: 'resend' | 'smtp' | 'none' } for startup logging. */
export function mailerStatus() {
    const { configured, provider } = mailConfig()
    return { configured, provider: provider ?? 'none' }
}

let cachedTransporter = null

function getTransporter() {
    const config = mailConfig()
    if (!config.host) return null
    if (cachedTransporter) return cachedTransporter

    cachedTransporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user && config.pass
            ? { user: config.user, pass: config.pass }
            : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
    })

    return cachedTransporter
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ))
}

function formatDate(value) {
    const date = value ? new Date(value) : new Date()
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    })
}

/**
 * Build the confirmation email for one registration.
 * Returns { subject, text, html } — pure so it can be previewed/tested.
 */
export function buildRegistrationEmail(user) {
    const config = mailConfig()
    const fullName = text(user?.fullName) || 'Eagle'
    const reference = text(user?.reference)
    const username = text(user?.username)
    const email = text(user?.email)
    const contactNumber = text(user?.contactNumber)
    const clubRegion = text(user?.clubRegion)
    const registeredAt = formatDate(user?.createdAt)

    const loginUrl = config.siteUrl
        ? `${config.siteUrl}/pages/login.html`
        : ''

    const rows = [
        ['Full name', fullName],
        ['Username', username],
        ['Email address', email],
        ['Contact number', contactNumber],
        ['Club region', clubRegion],
        ['Reference number', reference],
        ['Registered on', registeredAt],
    ].filter(([, value]) => value)

    const subject = 'Your 3rd Eagles Mindanao Convention Registration'

    const textLines = [
        `Hello ${fullName},`,
        '',
        'Thank you for registering for the 3rd Eagles Mindanao Convention!',
        'Here are the details we recorded:',
        '',
        ...rows.map(([label, value]) => `${label}: ${value}`),
        '',
        `Convention registration fee: ${MONEY.format(FEES.registration)}`,
        '',
        'Keep your reference number safe — you will need it, together with your',
        'username or email address, to sign in to your member dashboard.',
        loginUrl ? `Sign in: ${loginUrl}` : 'Sign in through the Member Login page.',
        '',
        'If you reserved a convention t-shirt, it will appear on your dashboard.',
        'If any of these details are incorrect, contact the secretariat.',
        '',
        'See you at the convention!',
        '3rd Eagles Mindanao Convention Secretariat',
    ]

    const htmlRows = rows.map(([label, value]) => `
        <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #ece6d6;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#b9870e;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #ece6d6;font-size:15px;font-weight:600;color:#1b2a4a;overflow-wrap:anywhere;">${escapeHtml(value)}</td>
        </tr>`).join('')

    const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#faf6ec;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;color:#1f2733;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ec;padding:24px 12px;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(16,29,51,.12);">
                    <tr>
                        <td style="background:#1b2a4a;background:linear-gradient(165deg,#101d33,#1b2a4a 55%,#27395e);padding:28px 28px 24px;">
                            <div style="font-size:12px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#e3b53a;margin-bottom:8px;">3rd Eagles Mindanao Convention</div>
                            <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:#faf6ec;">Registration confirmed</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:26px 28px 8px;">
                            <p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:#1f2733;">Hello <strong>${escapeHtml(fullName)}</strong>,</p>
                            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#5c6675;">Thank you for registering for the 3rd Eagles Mindanao Convention. Here are the details we recorded:</p>

                            <div style="margin:0 0 18px;padding:14px 16px;border-radius:10px;background:#faf3dd;border:1px dashed #b9870e;">
                                <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#b9870e;">Your reference number</div>
                                <div style="margin-top:4px;font-family:Consolas,'SFMono-Regular',monospace;font-size:20px;font-weight:700;letter-spacing:.08em;color:#1b2a4a;">${escapeHtml(reference || '—')}</div>
                            </div>

                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:1px solid #ece6d6;">
                                ${htmlRows}
                            </table>

                            <p style="margin:18px 0 6px;font-size:15px;line-height:1.6;color:#1f2733;">Convention registration fee: <strong>${escapeHtml(MONEY.format(FEES.registration))}</strong></p>
                            <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#5c6675;">Keep your reference number safe — you will need it, together with your username or email address, to sign in to your member dashboard.</p>

                            ${loginUrl ? `<p style="margin:0 0 20px;"><a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#d4a017;color:#1b2a4a;font-size:15px;font-weight:700;text-decoration:none;">Go to Member Login</a></p>` : ''}

                            <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#5c6675;">If you reserved a convention t-shirt, it will appear on your dashboard. If any of these details are incorrect, contact the secretariat.</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:18px 28px 26px;">
                            <p style="margin:0;font-size:14px;line-height:1.6;color:#1b2a4a;font-weight:600;">See you at the convention!</p>
                            <p style="margin:2px 0 0;font-size:13px;color:#5c6675;">3rd Eagles Mindanao Convention Secretariat</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`

    return { subject, text: textLines.join('\n'), html }
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** Deliver through the Resend HTTP API (works where outbound SMTP is blocked). */
async function sendWithResend({ apiKey, from, to, subject, text: plainText, html }) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    try {
        const response = await fetch(RESEND_ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ from, to, subject, text: plainText, html }),
            signal: controller.signal,
        })

        const body = await response.json().catch(() => null)

        if (!response.ok) {
            const detail =
                body?.message || body?.error?.message || response.statusText
            throw new Error(`Resend responded ${response.status}: ${detail}`)
        }

        return { messageId: body?.id ?? null }
    } finally {
        clearTimeout(timeout)
    }
}

/**
 * Send the registration confirmation and never throw: a mail failure must not
 * break a successful registration.
 */
export async function sendRegistrationEmail(user) {
    const recipient = text(user?.email)
    if (!recipient) {
        return { sent: false, skipped: true, reason: 'no-email' }
    }

    const config = mailConfig()

    if (!config.configured) {
        console.warn(
            '[mail] Email is not configured — registration email not sent. ' +
            'Set RESEND_API_KEY, or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS, in .env.'
        )
        return { sent: false, skipped: true, reason: 'not-configured' }
    }

    const { subject, text: plainText, html } = buildRegistrationEmail(user)

    try {
        let messageId = null

        if (config.provider === 'resend') {
            const result = await sendWithResend({
                apiKey: config.resendApiKey,
                from: config.from,
                to: recipient,
                subject,
                text: plainText,
                html,
            })
            messageId = result.messageId
        } else {
            const transporter = getTransporter()

            if (!transporter) {
                console.warn('[mail] SMTP is not configured — registration email not sent.')
                return { sent: false, skipped: true, reason: 'not-configured' }
            }

            const info = await transporter.sendMail({
                from: config.from,
                to: recipient,
                subject,
                text: plainText,
                html,
            })
            messageId = info.messageId ?? null
        }

        console.log(
            `[mail] Registration email sent to ${recipient} via ${config.provider} ` +
            `(${messageId ?? 'no id'})`
        )
        return { sent: true, provider: config.provider, messageId }
    } catch (error) {
        console.error(
            `[mail] Could not send registration email to ${recipient} via ` +
            `${config.provider}: ${error.message}`
        )
        return { sent: false, provider: config.provider, error: error.message }
    }
}
