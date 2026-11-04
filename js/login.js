/* ═══════════════════════════════════════════════════════════
   3rd Eagles Mindanao Convention — Member Login
   Signs in through the Express + Supabase API using the
   username and reference number issued at registration, then
   caches the member's profile and shirts locally so the
   dashboard can render instantly.

   Reference format (issued at registration):
       EMC-<BASE36-TIMESTAMP>-<4 RANDOM BASE36 CHARS>
   e.g. EMC-LX3K9Q2AB-7F2D
   Hyphens and case are ignored when verifying.
   ═══════════════════════════════════════════════════════════ */

const STORAGE_KEY   = 'emc-registrations';
const SESSION_KEY   = 'emc-session';
const DASHBOARD_URL = 'dashboard.html';
const API           = window.EMCApi;

const loginForm   = document.getElementById('loginForm');
const errorBanner = document.getElementById('loginError');
const nameInput   = document.getElementById('memberUsername');
const refInput    = document.getElementById('refNumber');
const submitBtn   = document.getElementById('loginSubmitBtn');

/* ── Reference helpers — same EMC-* format as the convention page ── */

/** Strip everything except A-Z0-9 and uppercase → stable comparison key */
function refCompareKey(value) {
    return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Validate the reference looks like EMC + stamp(≥7) + 4 random chars */
function isValidRefFormat(compareKey) {
    return /^EMC[0-9A-Z]{7,16}$/.test(compareKey);
}

/* ── Local cache of registrations (dashboard reads this) ───── */
function getStoredRegistrations() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn('Could not read cached registrations:', err);
        return [];
    }
}

/**
 * Pull the member's profile and shirt reservations from the API and
 * rewrite their cached records in the shape dashboard.js expects.
 */
async function syncMemberCache(user) {
    const base = {
        fullName:      user.fullName,
        username:      user.username,
        contactNumber: user.contactNumber,
        clubRegion:    user.clubRegion,
        registeredAt:  user.createdAt,
        reference:     user.reference,
    };

    let shirts = [];

    try {
        const result = await API.request(
            `/api/shirts?reference=${encodeURIComponent(user.reference)}`
        );
        shirts = Array.isArray(result.shirts) ? result.shirts : [];
    } catch (err) {
        // Login still succeeds if the shirt lookup fails; the dashboard
        // will simply show the registration order.
        console.warn('Could not load shirts from the API:', err);
    }

    const records = [{ ...base, type: 'registration', tshirt: null }];

    for (const shirt of [...shirts].reverse()) {
        records.push({
            ...base,
            type: 'tshirt',
            shirtId: shirt.id ?? null,
            tshirt: {
                size: shirt.size,
                qty: shirt.qty,
                nameOnShirt: shirt.nameOnShirt ?? null,
            },
        });
    }

    try {
        const kept = getStoredRegistrations().filter(
            r => refCompareKey(r?.reference) !== refCompareKey(user.reference)
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...kept, ...records]));
    } catch (err) {
        console.warn('Could not cache the member profile:', err);
    }
}

/* ── Inline field state ──────────────────────────────────── */
function setFieldState(input, message) {
    const errorEl = input.closest('.form-field')?.querySelector('.field-error');
    if (errorEl) errorEl.textContent = message ?? '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    return !message;
}

[...loginForm.elements].forEach(el => {
    if (!(el instanceof HTMLElement)) return;
    el.addEventListener('input', () => {
        if (el.getAttribute('aria-invalid') === 'true') setFieldState(el, '');
        hideError();
    });
});

/** Live hygiene for the reference field: uppercase, allow A-Z 0-9 and hyphens */
refInput.addEventListener('input', function () {
    let value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Insert dashes after EMC and after the next 9 characters
    value = value.slice(0, 3) +
        (value.length > 3 ? '-' + value.slice(3, 12) : '') +
        (value.length > 12 ? '-' + value.slice(12, 16) : '');

    this.value = value;
});

/* ── Error banner ────────────────────────────────────────── */
function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.remove('is-hidden');
}
function hideError() {
    errorBanner.textContent = '';
    errorBanner.classList.add('is-hidden');
}

/* ── Submit: verify with the API, open session, go to dashboard ── */
loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideError();

    const username = nameInput.value.trim();

    const nameOk = setFieldState(nameInput,
        username.length >= 2 ? '' : 'Please enter your username.');

    const compareKey = refCompareKey(refInput.value);
    const refOk = setFieldState(refInput,
        isValidRefFormat(compareKey)
            ? ''
            : 'That doesn’t look like a reference number (format: EMC-XXXXXXXX-XXXX).');

    if (!nameOk || !refOk) return;

    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    try {
        const result = await API.request('/api/users/login', {
            method: 'POST',
            body: {
                reference: refInput.value,
                username,
            },
        });

        const user = result.user;
        await syncMemberCache(user);

        try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify({
                refKey:        refCompareKey(user.reference),
                reference:     user.reference,
                username:      user.username,
                fullName:      user.fullName,
                clubRegion:    user.clubRegion,
                contactNumber: user.contactNumber,
                signedInAt:    new Date().toISOString(),
            }));
        } catch (err) {
            console.warn('Could not persist session:', err);
        }

        window.location.href = DASHBOARD_URL;
    } catch (err) {
        console.error('Login failed:', err);

        if (err.status === 401) {
            showError('The username and reference number do not match our records.');
        } else {
            showError(err.message || 'Could not sign in. Please try again.');
        }
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
    }
});

/* ── Autofocus the first field on load ───────────────────── */
nameInput.focus();
