/* ═══════════════════════════════════════════════════════════
   3rd Eagles Mindanao Convention — Interactions
   Flow: Register Now → Registration dialog
         → on submit → T-shirt dialog (ask → form → success)
   ═══════════════════════════════════════════════════════════ */

const navToggle     = document.getElementById('navToggle');
const navLinks      = document.getElementById('navLinks');
const navbar        = document.getElementById('navbar');
const footerYear    = document.getElementById('footerYear');
const toastEl       = document.getElementById('toast');

const registerDialog = document.getElementById('registerDialog');
const registerForm   = document.getElementById('registerForm');

const shirtDialog      = document.getElementById('shirtDialog');
const shirtAskPanel    = document.getElementById('shirtAskPanel');
const shirtForm        = document.getElementById('shirtForm');
const shirtSuccessPanel = document.getElementById('shirtSuccessPanel');
const shirtAcceptBtn   = document.getElementById('shirtAcceptBtn');
const shirtDeclineBtn  = document.getElementById('shirtDeclineBtn');
const shirtBackBtn     = document.getElementById('shirtBackBtn');
const referenceNumber  = document.getElementById('referenceNumber');

const STORAGE_KEY = 'emc-registrations';
const API = window.EMCApi;

const api = {
    register: (body) => API.request('/api/users/register', { method: 'POST', body }),
    addShirt: (body) => API.request('/api/shirts', { method: 'POST', body }),
};

/* ── Footer year ─────────────────────────────────────────── */
footerYear.textContent = new Date().getFullYear();

/* ── Navbar: scroll shadow ───────────────────────────────── */
const onScroll = () => navbar.classList.toggle('is-scrolled', window.scrollY > 24);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ── Navbar: mobile hamburger ────────────────────────────── */
navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
    document.body.style.overflow = isOpen ? 'hidden' : '';
});

/* Close mobile menu when a link is tapped or viewport grows */
navLinks.addEventListener('click', (event) => {
    if (event.target.closest('a, button')) closeMobileMenu();
});
window.addEventListener('resize', () => {
    if (window.innerWidth > 860) closeMobileMenu();
});
function closeMobileMenu() {
    navLinks.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
}

/* ── Navbar: scroll-spy for active link ──────────────────── */
const sectionIds = ['home', 'about', 'contact'];
const navAnchors = new Map(
    [...navLinks.querySelectorAll('.nav-link')].map(a => [a.getAttribute('href').slice(1), a])
);
const spy = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (entry.isIntersecting) {
            navAnchors.forEach(a => a.classList.remove('active'));
            navAnchors.get(entry.target.id)?.classList.add('active');
        }
    }
}, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
sectionIds.forEach(id => {
    const section = document.getElementById(id);
    if (section) spy.observe(section);
});

/* ── Toast ───────────────────────────────────────────────── */
let toastTimer;
function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 4200);
}

/* ── Dialog helpers ──────────────────────────────────────── */
function openDialog(dialog) {
    if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
    } else {
        dialog.setAttribute('open', ''); // fallback for very old browsers
    }
}
function closeDialog(dialog) {
    if (dialog.open) dialog.close();
    else dialog.removeAttribute('open');
}

/* Close on backdrop click (click target === dialog itself) */
document.querySelectorAll('dialog.dialog').forEach(dialog => {
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) closeDialog(dialog);
    });
});

/* Any element with [data-close-dialog] closes its nearest dialog */
document.querySelectorAll('[data-close-dialog]').forEach(btn => {
    btn.addEventListener('click', () => {
        const dialog = btn.closest('dialog');
        if (dialog) closeDialog(dialog);
    });
});

/* ── Registration state (shared between the two dialogs) ─── */
let currentRegistration = null;

/* ── Open registration dialog from any .openRegisterForm ─── */
document.querySelectorAll('.openRegisterForm').forEach(btn => {
    btn.addEventListener('click', () => {
        closeMobileMenu();
        openDialog(registerDialog);
        // Focus the first field once the dialog is visible
        requestAnimationFrame(() => document.getElementById('fullName')?.focus());
    });
});

/* ── Validation helpers ──────────────────────────────────── */
const PH_CONTACT = /^(09\d{9}|\+639\d{9}|0\d{6,10})$/; // PH mobile or landline-ish

function setFieldState(input, message) {
    const errorEl = input.closest('.form-field')?.querySelector('.field-error');
    if (errorEl) errorEl.textContent = message ?? '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    return !message;
}

function validateRegistration() {
    const name     = document.getElementById('fullName');
    const username = document.getElementById('username');
    const contact  = document.getElementById('contactNumber');
    const region   = document.getElementById('clubRegion');

    const digits = contact.value.replace(/[\s()-]/g, '');

    const okName = setFieldState(name,
        name.value.trim().length >= 2 ? '' : 'Please enter your full name.');
    const okUsername = setFieldState(username,
        /^[A-Za-z0-9._-]{2,32}$/.test(username.value.trim())
            ? ''
            : 'Use 2–32 letters, numbers, dots, underscores, or hyphens.');
    const okContact = setFieldState(contact,
        PH_CONTACT.test(digits) ? '' : 'Enter a valid PH number, e.g. 09171234567.');
    const okRegion  = setFieldState(region,
        region.value ? '' : 'Please select your club region.');

    return okName && okUsername && okContact && okRegion;
}

function validateShirt() {
    const size = document.getElementById('shirtSize');
    const qty  = document.getElementById('shirtQty');

    const okSize = setFieldState(size, size.value ? '' : 'Please choose a size.');
    const qtyNum = Number(qty.value);
    const okQty  = setFieldState(qty,
        Number.isInteger(qtyNum) && qtyNum >= 1 && qtyNum <= 10
            ? '' : 'Quantity must be between 1 and 10.');

    return okSize && okQty;
}

/* Clear a field's error as the user fixes it */
[...registerForm.elements, ...shirtForm.elements].forEach(el => {
    if (!(el instanceof HTMLElement)) return;
    el.addEventListener('input', () => {
        if (el.getAttribute('aria-invalid') === 'true') setFieldState(el, '');
    });
    el.addEventListener('change', () => {
        if (el.getAttribute('aria-invalid') === 'true') setFieldState(el, '');
    });
});

/* ── Local cache (Supabase is the source of truth) ───────── */
function refKey(value) {
    return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function saveRegistration(record) {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
        const existing = Array.isArray(parsed) ? parsed : [];

        // Replace the previous record of the same type for this member.
        const kept = existing.filter(r =>
            !(r && refKey(r.reference) === refKey(record.reference) && r.type === record.type)
        );

        kept.push(record);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
    } catch (err) {
        console.warn('Could not cache registration locally:', err);
    }
}

/* ── Shirt dialog panel switching ────────────────────────── */
function showShirtPanel(panel) {
    [shirtAskPanel, shirtForm, shirtSuccessPanel].forEach(p =>
        p.classList.toggle('is-hidden', p !== panel));
}

function openShirtDialog() {
    showShirtPanel(shirtAskPanel);   // always start at the "ask" step
    openDialog(shirtDialog);
}

/* ── FLOW STEP 1 → 2: registration submit ────────────────── */
const registerSubmitBtn = registerForm.querySelector('button[type="submit"]');

registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validateRegistration()) {
        showToast('Please fix the highlighted fields.');
        return;
    }

    const usernameInput = document.getElementById('username');
    const originalLabel = registerSubmitBtn.textContent;

    registerSubmitBtn.disabled = true;
    registerSubmitBtn.textContent = 'Registering…';

    try {
        const result = await api.register({
            fullName:      document.getElementById('fullName').value.trim(),
            username:      usernameInput.value.trim(),
            contactNumber: document.getElementById('contactNumber').value.trim(),
            clubRegion:    document.getElementById('clubRegion').value,
        });

        const user = result.user;

        currentRegistration = {
            fullName:      user.fullName,
            username:      user.username,
            contactNumber: user.contactNumber,
            clubRegion:    user.clubRegion,
            registeredAt:  user.createdAt,
            reference:     user.reference, // issued by the server
            tshirt:        null,
        };

        saveRegistration({ ...currentRegistration, type: 'registration' });

        closeDialog(registerDialog);
        registerForm.reset();
        showToast(`Welcome aboard, ${currentRegistration.fullName.split(' ')[0]}! One more step…`);
        openShirtDialog();
    } catch (err) {
        console.error('Registration failed:', err);

        if (err.status === 409) {
            setFieldState(usernameInput, err.message);
        }

        showToast(err.message || 'Registration failed. Please try again.');
    } finally {
        registerSubmitBtn.disabled = false;
        registerSubmitBtn.textContent = originalLabel;
    }
});

/* ── FLOW STEP 2a: user declines the shirt — still get the reference ── */
const successMessage = document.getElementById('successMessage');

function showSuccessPanel(message) {
    if (successMessage) successMessage.textContent = message;
    referenceNumber.textContent = currentRegistration?.reference ?? '—';
    showShirtPanel(shirtSuccessPanel);
}

shirtDeclineBtn.addEventListener('click', () => {
    showSuccessPanel('Your registration has been recorded. Save your reference number — you will use it with your username to log in.');
    showToast('See you at the convention!');
});

/* ── FLOW STEP 2b: user wants the shirt → show shirt form ── */
shirtAcceptBtn.addEventListener('click', () => {
    showShirtPanel(shirtForm);
    requestAnimationFrame(() => document.getElementById('shirtSize')?.focus());
});

shirtBackBtn.addEventListener('click', () => showShirtPanel(shirtAskPanel));

/* ── FLOW STEP 2c: shirt form submit → success ───────────── */
const shirtSubmitBtn = shirtForm.querySelector('button[type="submit"]');

shirtForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validateShirt()) {
        showToast('Please fix the highlighted fields.');
        return;
    }

    if (!currentRegistration?.reference) {
        showToast('Please complete the registration form first.');
        return;
    }

    const shirt = {
        size: document.getElementById('shirtSize').value,
        qty:  Number(document.getElementById('shirtQty').value),
    };

    const originalLabel = shirtSubmitBtn.textContent;
    shirtSubmitBtn.disabled = true;
    shirtSubmitBtn.textContent = 'Saving…';

    try {
        const result = await api.addShirt({
            reference: currentRegistration.reference,
            ...shirt,
        });

        currentRegistration.tshirt = shirt;
        saveRegistration({
            ...currentRegistration,
            type: 'tshirt',
            shirtId: result?.shirt?.id ?? null,
        });

        referenceNumber.textContent = currentRegistration.reference;
        if (successMessage) successMessage.textContent =
            'Your registration and t-shirt reservation have been recorded. Save your reference number — you will use it with your username to log in.';

        shirtForm.reset();
        document.getElementById('shirtQty').value = 1;
        showShirtPanel(shirtSuccessPanel);
        currentRegistration = null;
    } catch (err) {
        console.error('Shirt reservation failed:', err);
        showToast(err.message || 'Could not save the shirt reservation. Please try again.');
    } finally {
        shirtSubmitBtn.disabled = false;
        shirtSubmitBtn.textContent = originalLabel;
    }
});

/* ── Reset shirt dialog to a clean state when closed ─────── */
shirtDialog.addEventListener('close', () => {
    // Return to the ask panel for next time, keep success visible until closed
    if (shirtSuccessPanel.classList.contains('is-hidden')) {
        showShirtPanel(shirtAskPanel);
    }
});
