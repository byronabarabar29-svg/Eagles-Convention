/* ═══════════════════════════════════════════════════════════
   3rd Eagles Mindanao Convention — Member Dashboard

   Reads the signed-in member (sessionStorage: emc-session),
   derives their orders from the local cache (localStorage:
   emc-registrations), which login/registration fills from the
   Supabase-backed API, and persists payment updates per member
   (localStorage: emc-orders, keyed by reference).

   Order fees live in FEES below — adjust if rates change.
   ═══════════════════════════════════════════════════════════ */

const STORAGE_KEY  = 'emc-registrations';
const ORDERS_KEY   = 'emc-orders';
const SESSION_KEY  = 'emc-session';
const DEMO_REF_KEY = 'EMCDEMO2026AA7F2D';
const DEMO_REFERENCE = 'EMC-DEMO2026AA-7F2D';
const API = window.EMCApi;

/* ═══════════════════════════════════════════════════════════
   PURE LOGIC — extracted for node testing (markers below)
   ═══════════════════════════════════════════════════════════ */
// ── BEGIN PURE ──
const FEES = Object.freeze({ registration: 1500, tshirt: 350 });

function refCompareKey(value) {
    return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function refPretty(compareKey) {
    if (!compareKey || compareKey.length < 10) return compareKey || '';
    return `EMC-${compareKey.slice(3, -4)}-${compareKey.slice(-4)}`;
}

/** Merge all records belonging to one reference into a member profile */
function mergeMemberRecords(records) {
    if (!Array.isArray(records) || records.length === 0) return null;
    return records.reduce((merged, record) => ({
        fullName:      merged.fullName      ?? record.fullName      ?? null,
        email:         merged.email         ?? record.email         ?? null,
        contactNumber: merged.contactNumber ?? record.contactNumber ?? null,
        clubRegion:    merged.clubRegion    ?? record.clubRegion    ?? null,
        registeredAt:  merged.registeredAt  ?? record.registeredAt  ?? null,
        reference:     merged.reference     ?? record.reference     ?? null,
        tshirt:        merged.tshirt       ?? record.tshirt        ?? null,
    }), { tshirt: null });
}

/**
 * Build the order list for one member from their raw records.
 * Saved payment state (status/payment) is merged back in by order id,
 * so totals/qtys follow the records while payment progress persists.
 *
 * Ids are stable: registration is `<refKey>-R`, shirts use the database id
 * (`<refKey>-S<uuid>`) so deleting one row never shifts another row's saved
 * payment state. `legacyId` keeps older saved data readable.
 */
function buildOrders(records, savedOrders) {
    if (!Array.isArray(records) || records.length === 0) return [];

    const refKey = refCompareKey(records[0]?.reference);
    const savedById = new Map((savedOrders ?? []).map(o => [o.id, o]));
    const orders = [];
    const usedNumbers = new Set();
    let nextShirtNumber = 2;

    const pushOrder = (seq, kind, title, subtitle, qty, unitPrice, details = {}) => {
        const legacyId = `${refKey}-${String(seq).padStart(2, '0')}`;
        const stablePart = kind === 'registration'
            ? 'R'
            : details.shirtId
                ? `S${details.shirtId}`
                : `T${String(seq).padStart(2, '0')}`;
        const id = `${refKey}-${stablePart}`;
        const prior = savedById.get(id) ?? savedById.get(legacyId);

        // Keep the display number a member already saw; new items take the
        // next free slot so deleting one row never renumbers the others.
        let number = kind === 'registration'
            ? 1
            : Number.isInteger(prior?.number) && !usedNumbers.has(prior.number)
                ? prior.number
                : nextShirtNumber;
        while (usedNumbers.has(number)) number += 1;
        usedNumbers.add(number);
        nextShirtNumber = Math.max(nextShirtNumber, number + 1);

        orders.push({
            id,
            legacyId,
            number,
            orderNo: `${refPretty(refKey)}-${String(number).padStart(2, '0')}`,
            kind,
            title,
            subtitle,
            qty,
            unitPrice,
            total: qty * unitPrice,
            status:  prior?.status  ?? 'pending',   // 'pending' | 'submitted'
            payment: prior?.payment ?? null,        // { method, txnRef, txnDate, submittedAt }
            shirtId: details.shirtId ?? null,
            size: details.size ?? null,
            nameOnShirt: details.nameOnShirt ?? null,
        });
    };

    let shirtSeq = 2;

    for (const record of records) {
        if (record.type === 'registration') {
            pushOrder(1, 'registration',
                'Convention Registration',
                '3rd Eagles Mindanao Convention — delegate fee',
                1, FEES.registration);
        } else if (record.type === 'tshirt' && record.tshirt) {
            const nameOnShirt = record.tshirt.nameOnShirt ?? null;

            pushOrder(shirtSeq++, 'tshirt',
                `Convention T-Shirt — Size ${record.tshirt.size}`,
                nameOnShirt
                    ? `Official convention shirt × ${record.tshirt.qty} · Name in shirt: ${nameOnShirt}`
                    : `Official convention shirt × ${record.tshirt.qty}`,
                Number(record.tshirt.qty) || 1, FEES.tshirt, {
                    shirtId: record.shirtId ?? null,
                    size: record.tshirt.size,
                    nameOnShirt,
                });
        }
    }

    // stable order: registration first, then t-shirts
    return orders.sort((a, b) => a.number - b.number);
}

function ordersTotal(orders) {
    return (orders ?? []).reduce((sum, o) => sum + (o.total ?? 0), 0);
}

function amountDue(orders) {
    return (orders ?? [])
        .filter(o => o.status !== 'submitted' && o.status !== 'verified')
        .reduce((s, o) => s + (o.total ?? 0), 0);
}

function overallStatus(orders) {
    if (!orders || orders.length === 0) return 'pending';
    if (orders.every(o => o.status === 'verified')) return 'verified';
    if (orders.some(o => o.status === 'rejected')) return 'rejected';
    if (orders.every(o => o.status === 'submitted' || o.status === 'verified')) return 'submitted';
    return 'pending';
}

/** Map the server payment status to the status used by order rows. */
function paymentToOrderStatus(status) {
    if (status === 'verified') return 'verified';
    if (status === 'rejected') return 'rejected';
    return 'submitted'; // pending review
}

/**
 * Merge the server's payment (including verification) into the local orders.
 * One payment covers every order, so all rows share the same status.
 */
function applyPaymentToOrders(orders, payment) {
    if (!payment) return orders;

    const status = paymentToOrderStatus(payment.status);

    return (orders ?? []).map(o => ({
        ...o,
        status,
        payment: {
            method:       payment.method ?? null,
            txnRef:       payment.txnRef ?? null,
            txnDate:      payment.txnDate ?? null,
            receiptImage: payment.receiptImage ?? null,
            submittedAt:  payment.submittedAt ?? null,
            status:       payment.status ?? 'pending',
            note:         payment.note ?? null,
            verifiedAt:   payment.verifiedAt ?? null,
        },
    }));
}

/** Initials for the avatar, e.g. "Juan Dela Cruz" → "JD" */
function initialsOf(fullName) {
    const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'M';
    const first = parts[0][0] ?? '';
    const last  = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
}

/** First name for the greeting */
function firstNameOf(fullName) {
    const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
    return parts[0] ?? 'Member';
}
// ── END PURE ──

/* ═══════════════════════════════════════════════════════════
   DOM WIRING
   ═══════════════════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);

const dashContent     = $('dashContent');
const signedOutPanel  = $('signedOutPanel');
const toastEl         = $('toast');

const statOrders        = $('statOrders');
const statAmountDue     = $('statAmountDue');
const statAmountSub     = $('statAmountSub');
const statPaymentStatus = $('statPaymentStatus');

const welcomeAvatar    = $('welcomeAvatar');
const welcomeFirstName = $('welcomeFirstName');
const chipRegion       = $('chipRegion');
const chipContact      = $('chipContact');
const chipEmail        = $('chipEmail');
const chipRegistered   = $('chipRegistered');
const memberReference  = $('memberReference');
const copyRefBtn       = $('copyRefBtn');

const ordersTableBody  = $('ordersTableBody');
const ordersGrandTotal = $('ordersGrandTotal');
const orderCountPill   = $('orderCountPill');
const timelinePill     = $('timelinePill');
const paymentTimeline  = $('paymentTimeline');

const deleteOrderDialog = $('deleteOrderDialog');
const deleteOrderText   = $('deleteOrderText');
const deleteOrderError  = $('deleteOrderError');
const cancelDeleteBtn   = $('cancelDeleteBtn');
const confirmDeleteBtn  = $('confirmDeleteBtn');

let currentOrders = [];
let pendingDelete = null;

const paymentMethod  = $('paymentMethod');
const txnRef         = $('txnRef');
const txnRefField    = $('txnRefField');
const txnDate        = $('txnDate');
const paymentAmount  = $('paymentAmount');
const paymentLead    = $('paymentLead');
const paymentForm    = $('paymentForm');
const paymentSubmitBtn = $('paymentSubmitBtn');

const receiptImage     = $('receiptImage');
const receiptDrop      = $('receiptDrop');
const receiptDropInner = $('receiptDropInner');
const receiptError     = $('receiptError');
const receiptCurrent   = $('receiptCurrent');
const receiptThumb     = $('receiptThumb');
const receiptView      = $('receiptView');
const receiptRemoveBtn = $('receiptRemoveBtn');

const emptyState     = $('emptyState');
const seedDemoBtn    = $('seedDemoBtn');
const clearDemoBtn   = $('clearDemoBtn');

const signOutBtn       = $('signOutBtn');
const printSummaryBtn  = $('printSummaryBtn');

const fmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });

/* ── Toast ───────────────────────────────────────────────── */
let toastTimer;
function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 4500);
}

/* ── Session ─────────────────────────────────────────────── */
function getSession() {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && parsed.refKey ? parsed : null;
    } catch {
        return null;
    }
}

/* ── Per-member orders persistence ({ [refKey]: Order[] }) ── */
function readOrdersMap() {
    try {
        const raw = localStorage.getItem(ORDERS_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}
function writeOrdersMap(map) {
    try { localStorage.setItem(ORDERS_KEY, JSON.stringify(map)); }
    catch (err) { console.warn('Could not persist orders:', err); }
}
function getSavedOrders(refKey) {
    return readOrdersMap()[refKey] ?? [];
}
function saveOrders(refKey, orders) {
    const map = readOrdersMap();
    map[refKey] = orders;
    writeOrdersMap(map);
}

/* ── Registrations for this member ───────────────────────── */
function getMemberRecords(refKey) {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(r => r && typeof r.reference === 'string' && refCompareKey(r.reference) === refKey);
    } catch {
        return [];
    }
}

/** Replace one member's cached records, leaving other members untouched. */
function saveMemberRecords(refKey, memberRecords) {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        const all = Array.isArray(parsed) ? parsed : [];
        const kept = all.filter(r =>
            !(r && typeof r.reference === 'string' && refCompareKey(r.reference) === refKey)
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...kept, ...memberRecords]));
    } catch (err) {
        console.warn('Could not update cached registrations:', err);
    }
}

/** Drop saved payment state for an order that was removed. */
function forgetOrderState(refKey, order) {
    const map = readOrdersMap();
    map[refKey] = (map[refKey] ?? []).filter(
        o => o.id !== order.id && o.id !== order.legacyId
    );
    writeOrdersMap(map);
}

/* ── Receipt image: choose / drag & drop / auto-resize ───── */
const RECEIPT_MAX_PX   = 800;
const RECEIPT_MAX_CHARS = 450_000;   // ≈ 300 KB as base64 JPEG
let pendingReceipt = null;           // null = keep prior | '' = remove | 'data:...' = new file
const receiptDropOriginalHTML = receiptDropInner.innerHTML;

function setReceiptError(message) {
    if (receiptError) receiptError.textContent = message ?? '';
}

function fileToResizedDataURL(file, maxPx, quality) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const scale = Math.min(1, maxPx / Math.max(img.width, img.height, 1));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
        img.src = url;
    });
}

function showPendingReceipt(fileName) {
    receiptDrop.classList.add('has-file');
    receiptDropInner.innerHTML = `
        <span class="receipt-drop-icon" aria-hidden="true">🧾</span>
        <span class="receipt-drop-text">Receipt attached — tap to replace</span>
        <span class="receipt-drop-filename">${escapeHtml(fileName ?? 'receipt.jpg')}</span>`;
}

function resetReceiptDrop() {
    receiptDrop.classList.remove('has-file', 'is-dragover');
    receiptDropInner.innerHTML = receiptDropOriginalHTML;
    if (receiptImage) receiptImage.value = '';
}

async function handleReceiptFile(file) {
    setReceiptError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        setReceiptError('That file is not an image — choose a screenshot or photo.');
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        setReceiptError('That image is too large (over 8 MB).');
        return;
    }
    try {
        let dataUrl = await fileToResizedDataURL(file, RECEIPT_MAX_PX, 0.72);
        if (dataUrl.length > RECEIPT_MAX_CHARS) dataUrl = await fileToResizedDataURL(file, RECEIPT_MAX_PX, 0.5);
        if (dataUrl.length > RECEIPT_MAX_CHARS) {
            setReceiptError('Still too large after resizing — try a tighter screenshot.');
            return;
        }
        pendingReceipt = dataUrl;
        showPendingReceipt(file.name);
    } catch {
        setReceiptError('Could not read that image.');
    }
}

receiptImage?.addEventListener('change', () => handleReceiptFile(receiptImage.files?.[0]));

['dragenter', 'dragover'].forEach(type =>
    receiptDrop?.addEventListener(type, (e) => { e.preventDefault(); e.stopPropagation(); receiptDrop.classList.add('is-dragover'); }));
['dragleave', 'dragend', 'drop'].forEach(type =>
    receiptDrop?.addEventListener(type, (e) => { e.preventDefault(); e.stopPropagation(); receiptDrop.classList.remove('is-dragover'); }));
receiptDrop?.addEventListener('drop', (e) => handleReceiptFile(e.dataTransfer?.files?.[0]));

receiptRemoveBtn?.addEventListener('click', () => {
    pendingReceipt = '';               // sentinel: delete saved receipt on next save
    receiptCurrent.classList.add('is-hidden');
    resetReceiptDrop();
    showToast('Receipt will be removed when you save.');
});

// ── END receipt helpers ──

/* ── Field state helper (mirrors login page) ─────────────── */
function setFieldState(input, message) {
    const errorEl = input.closest('.form-field')?.querySelector('.field-error');
    if (errorEl) errorEl.textContent = message ?? '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    return !message;
}
[...paymentForm.elements].forEach(el => {
    if (!(el instanceof HTMLElement)) return;
    el.addEventListener('input', () => { if (el.getAttribute('aria-invalid') === 'true') setFieldState(el, ''); });
    el.addEventListener('change', () => { if (el.getAttribute('aria-invalid') === 'true') setFieldState(el, ''); });
});

/* Cash needs no transaction ref — toggle visibility/requirement */
paymentMethod.addEventListener('change', () => {
    const isCash = paymentMethod.value === 'Cash';
    txnRefField.classList.toggle('is-hidden', isCash);
    paymentMethod.closest('.payment-fields')?.classList.toggle('is-cash', isCash);
    txnRef.required = !isCash;
    if (isCash) setFieldState(txnRef, '');
});

/* Default date of payment = today (and never in the future) */
txnDate.max = new Date().toISOString().slice(0, 10);
txnDate.value = txnDate.max;

/* ═══════════════════════════════════════════════════════════
   RENDERING
   ═══════════════════════════════════════════════════════════ */
function renderMember(session, member) {
    const name = member?.fullName ?? session.fullName ?? 'Member';
    welcomeFirstName.textContent = firstNameOf(name);
    welcomeAvatar.textContent    = initialsOf(name);
    chipRegion.textContent       = member?.clubRegion ?? session.clubRegion ?? '—';
    chipContact.textContent      = member?.contactNumber ?? session.contactNumber ?? '—';
    if (chipEmail) {
        chipEmail.textContent = member?.email ?? session.email ?? '—';
        chipEmail.classList.toggle('is-hidden', !(member?.email ?? session.email));
    }
    chipRegistered.textContent   = member?.registeredAt
        ? 'Registered ' + new Date(member.registeredAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : 'Registered —';
    memberReference.textContent  = refPretty(refCompareKey(session.refKey));
}

function renderStats(orders) {
    const due = amountDue(orders);
    statOrders.textContent    = String(orders.length);
    statAmountDue.textContent = fmt.format(due);
    statAmountSub.textContent = due === 0 ? 'nothing left to pay' : 'pending payment';
    const status = overallStatus(orders);
    const labels = {
        verified:  'Verified — Payment Confirmed',
        rejected:  'Rejected — Please Resubmit',
        submitted: 'Submitted — For Verification',
        pending:   'Pending Payment',
    };
    statPaymentStatus.textContent = labels[status] ?? labels.pending;
    statPaymentStatus.className   = 'status-pill ' + statusClass(status);
}

function statusLabel(status) {
    switch (status) {
        case 'verified':  return 'Verified';
        case 'rejected':  return 'Rejected';
        case 'submitted': return 'Submitted';
        default:          return 'Pending';
    }
}

function statusClass(status) {
    switch (status) {
        case 'verified':  return 'status-verified';
        case 'rejected':  return 'status-rejected';
        case 'submitted': return 'status-submitted';
        default:          return 'status-pending';
    }
}

const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>`;

function orderActionsCell(order) {
    if (order.kind === 'registration') {
        return `<span class="order-locked" title="The convention registration can't be removed online. Contact the secretariat if you need to cancel.">Required</span>`;
    }

    return `<button type="button" class="order-delete" data-order-id="${escapeHtml(order.id)}"
                    aria-label="Remove ${escapeHtml(order.title)}">
                ${TRASH_ICON}<span>Remove</span>
            </button>`;
}

function renderOrdersTable(orders) {
    if (orders.length === 0) {
        ordersTableBody.innerHTML = `
            <tr><td colspan="6" class="orders-empty">No orders to show.</td></tr>`;
    } else {
        ordersTableBody.innerHTML = orders.map(o => `
            <tr>
                <td data-label="Order No."><span class="order-id">${escapeHtml(o.orderNo)}</span></td>
                <td data-label="Item">
                    <div class="order-item">
                        <span class="order-kind ${o.kind === 'tshirt' ? 'order-kind-tshirt' : ''}">${o.kind === 'tshirt' ? 'T-Shirt' : 'Registration'}</span>
                        <div class="order-item-body">
                            <div class="order-item-title">${escapeHtml(o.title)}</div>
                            <div class="order-item-sub">${escapeHtml(o.subtitle)}</div>
                        </div>
                    </div>
                </td>
                <td data-label="Qty" class="col-qty">${o.qty}</td>
                <td data-label="Total" class="col-total">${fmt.format(o.total)}</td>
                <td data-label="Status"><span class="status-pill ${statusClass(o.status)}">${statusLabel(o.status)}</span></td>
                <td data-label="Actions" class="col-actions">${orderActionsCell(o)}</td>
            </tr>`).join('');
    }

    ordersGrandTotal.textContent = fmt.format(ordersTotal(orders));
    orderCountPill.textContent   = `${orders.length} order${orders.length === 1 ? '' : 's'}`;
}

function renderTimeline(orders) {
    const allVerified  = orders.length > 0 && orders.every(o => o.status === 'verified');
    const anyRejected  = orders.some(o => o.status === 'rejected');
    const allPaid      = orders.length > 0 &&
        orders.every(o => o.status === 'submitted' || o.status === 'verified');
    const somePaid     = orders.some(o => o.status !== 'pending');

    const steps = [
        { title: 'Registered', caption: 'Your place at the convention is recorded.', state: 'done' },
        {
            title: 'Payment Submitted',
            caption: allPaid
                ? 'Received — waiting for secretariat verification.'
                : somePaid
                    ? 'Partly submitted — complete the remaining orders.'
                    : 'Use the payment form to submit your payment details.',
            state: allPaid ? 'done' : somePaid ? 'current' : 'todo',
        },
        {
            title: 'Verified',
            caption: allVerified
                ? 'Payment confirmed. You are all set for the convention.'
                : anyRejected
                    ? 'The secretariat flagged your payment. Please resubmit your details.'
                    : allPaid
                        ? 'The secretariat is checking your payment.'
                        : 'The secretariat verifies payments after submission.',
            state: allVerified ? 'done' : anyRejected ? 'rejected' : allPaid ? 'current' : 'todo',
        },
    ];

    paymentTimeline.innerHTML = steps.map((s, i) => {
        const stateClass = s.state === 'done' ? 'is-done'
            : s.state === 'current' ? 'is-current'
                : s.state === 'rejected' ? 'is-rejected'
                    : '';
        const dot = s.state === 'done' ? '✓' : s.state === 'rejected' ? '!' : i + 1;

        return `
        <li class="timeline-step ${stateClass}">
            <span class="timeline-dot" aria-hidden="true">${dot}</span>
            <span class="timeline-step-title">${escapeHtml(s.title)}</span>
            <span class="timeline-step-caption">${escapeHtml(s.caption)}</span>
        </li>`;
    }).join('');

    timelinePill.textContent = allVerified
        ? 'Verified'
        : anyRejected
            ? 'Payment rejected'
            : allPaid
                ? 'For verification'
                : 'Not yet paid';
}

function renderPayment(orders) {
    const due = amountDue(orders);
    paymentAmount.value = fmt.format(due === 0 ? ordersTotal(orders) : due);

    const allVerified  = orders.length > 0 && orders.every(o => o.status === 'verified');
    const anyRejected  = orders.some(o => o.status === 'rejected');
    const allPaid      = orders.length > 0 &&
        orders.every(o => o.status === 'submitted' || o.status === 'verified');

    if (anyRejected) {
        paymentLead.textContent = 'The secretariat rejected your last payment. Update the details below to resubmit it for verification.';
    } else if (allVerified) {
        paymentLead.textContent = 'Your payment is verified. You can still update the details below if something changed.';
    } else if (allPaid) {
        paymentLead.textContent = 'All your orders are submitted for verification. You can still update the payment details below if something changed.';
    } else {
        paymentLead.textContent = 'One payment covers all your orders. Submit your payment details and they will be marked submitted for verification.';
    }

    paymentSubmitBtn.textContent = anyRejected
        ? 'Resubmit Payment Details'
        : allPaid
            ? 'Update Payment Details'
            : 'Save Payment Details';

    // Show the receipt that is currently saved (or a newly picked, not-yet-saved one)
    const savedReceipt = orders.find(o => o.payment?.receiptImage)?.payment?.receiptImage ?? null;
    const effective = pendingReceipt === '' ? null
        : (pendingReceipt ?? savedReceipt);
    receiptCurrent.classList.toggle('is-hidden', !effective);
    if (effective) {
        receiptThumb.src = effective;
        receiptView.href = effective;
    }
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

/* ── Composite render ────────────────────────────────────── */
function renderAll(state) {
    currentOrders = state.orders;
    renderMember(state.session, state.member);
    renderStats(state.orders);
    renderOrdersTable(state.orders);
    renderTimeline(state.orders);
    renderPayment(state.orders);
}

/* ── Payment sync with the server ────────────────────────── */
async function syncPaymentFromServer(session, refKey, orders, member) {
    if (!session || refKey === DEMO_REF_KEY) return;

    try {
        const result = await API.request(
            `/api/payments?reference=${encodeURIComponent(session.reference)}`
        );
        let payment = result.payment ?? null;

        // Older dashboards only saved payments in localStorage. Upload the
        // latest local copy once so the secretariat can verify it.
        if (!payment) {
            const local = orders.find(o => o.payment?.method && o.payment?.txnDate)?.payment ?? null;

            if (local) {
                try {
                    const saved = await API.request('/api/payments', {
                        method: 'POST',
                        body: {
                            reference: session.reference,
                            method: local.method,
                            txnRef: local.txnRef,
                            txnDate: local.txnDate,
                            receiptImage: local.receiptImage,
                        },
                    });
                    payment = saved.payment ?? null;
                } catch (err) {
                    console.warn('Could not upload the saved payment:', err);
                }
            }
        }

        if (!payment) return;

        const merged = applyPaymentToOrders(orders, payment);
        saveOrders(refKey, merged);
        renderAll({ session, member, orders: merged });
    } catch (err) {
        console.warn('Could not sync payment status:', err);
    }
}

/* ═══════════════════════════════════════════════════════════
   BOOTSTRAP
   ═══════════════════════════════════════════════════════════ */
const session = getSession();

if (!session) {
    signedOutPanel.classList.remove('is-hidden');
    // These actions are meaningless when signed out
    if (printSummaryBtn) printSummaryBtn.classList.add('is-hidden');
    if (signOutBtn) signOutBtn.classList.add('is-hidden');
} else {
    dashContent.classList.remove('is-hidden');

    const refKey  = refCompareKey(session.refKey);
    const records = getMemberRecords(refKey);
    const member  = mergeMemberRecords(records);

    // Demo mode: show the "remove sample data" link
    if (refKey === DEMO_REF_KEY) clearDemoBtn.classList.remove('is-hidden');

    if (records.length === 0) {
        // Signed in but no orders on this device (e.g. registered in another browser)
        ['.stats-grid', '.dash-grid', '.timeline-panel'].forEach(sel => {
            document.querySelector(sel)?.classList.add('is-hidden');
        });
        emptyState.classList.remove('is-hidden');
        renderMember(session, null);
    } else {
        const orders = buildOrders(records, getSavedOrders(refKey));
        saveOrders(refKey, orders); // persist merged shape back
        renderAll({ session, member, orders });
        syncPaymentFromServer(session, refKey, orders, member);
    }
}

/* ── Copy reference ──────────────────────────────────────── */
copyRefBtn?.addEventListener('click', async () => {
    const text = memberReference.textContent.trim();
    try {
        await navigator.clipboard.writeText(text);
        showToast('Reference copied to clipboard.');
    } catch {
        // Fallback for older browsers / non-secure contexts
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try { document.execCommand('copy'); showToast('Reference copied to clipboard.'); }
        catch { showToast('Copy not available — note it down: ' + text); }
        textarea.remove();
    }
});

/* ── Payment form ────────────────────────────────────────── */
paymentForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!session) return;

    const refKey  = refCompareKey(session.refKey);
    const records = getMemberRecords(refKey);
    if (records.length === 0) {
        showToast('No orders found on this device.');
        return;
    }
    const orders = buildOrders(records, getSavedOrders(refKey));

    const method = paymentMethod.value;
    const isCash = method === 'Cash';
    const ref    = txnRef.value.trim();

    const methodOk = setFieldState(paymentMethod, method ? '' : 'Choose a payment method.');
    const refOk    = setFieldState(txnRef,
        isCash || ref.length >= 4 ? '' : 'Enter the transaction reference (min. 4 characters).');
    const dateOk   = setFieldState(txnDate, txnDate.value ? '' : 'Choose the date of payment.');

    if (!methodOk || !refOk || !dateOk) {
        showToast('Please fix the highlighted fields.');
        return;
    }

    const priorReceipt = orders.find(o => o.payment?.receiptImage)?.payment?.receiptImage ?? null;
    const receiptImageValue = pendingReceipt === null
        ? priorReceipt                       // no new file picked → keep the saved one
        : (pendingReceipt === '' ? null : pendingReceipt);

    const payment = {
        method,
        txnRef:      isCash ? null : ref,
        txnDate:     txnDate.value,
        receiptImage: receiptImageValue,
        submittedAt: new Date().toISOString(),
        status:      'pending',
        note:        null,
        verifiedAt:  null,
    };

    const originalLabel = paymentSubmitBtn.textContent;
    paymentSubmitBtn.disabled = true;
    paymentSubmitBtn.textContent = 'Saving…';

    try {
        let savedPayment = null;

        // Demo data never leaves this browser.
        if (refKey !== DEMO_REF_KEY) {
            const result = await API.request('/api/payments', {
                method: 'POST',
                body: {
                    reference: session.reference,
                    method: payment.method,
                    txnRef: payment.txnRef,
                    txnDate: payment.txnDate,
                    receiptImage: payment.receiptImage,
                },
            });
            savedPayment = result.payment ?? null;
        }

        const updated = savedPayment
            ? applyPaymentToOrders(orders, savedPayment)
            : orders.map(o => ({ ...o, status: 'submitted', payment }));

        saveOrders(refKey, updated);
        pendingReceipt = null;
        resetReceiptDrop();
        renderAll({ session, member: mergeMemberRecords(records), orders: updated });
        showToast('Payment details saved — awaiting secretariat verification.');
    } catch (err) {
        console.error('Could not save payment details:', err);
        showToast(err.message || 'Could not save your payment details. Please try again.');
    } finally {
        paymentSubmitBtn.disabled = false;
        paymentSubmitBtn.textContent = originalLabel;
    }
});

/* ── Remove an order ─────────────────────────────────────── */
function setDeleteBusy(busy) {
    if (confirmDeleteBtn) {
        confirmDeleteBtn.disabled = busy;
        confirmDeleteBtn.textContent = busy ? 'Removing…' : 'Remove order';
    }
    if (cancelDeleteBtn) cancelDeleteBtn.disabled = busy;
}

function openDeleteDialog(order) {
    if (!deleteOrderDialog) return;

    pendingDelete = order;
    deleteOrderText.textContent = `${order.title} · ${fmt.format(order.total)}`;
    deleteOrderError.textContent = '';
    deleteOrderError.classList.add('is-hidden');
    setDeleteBusy(false);

    if (typeof deleteOrderDialog.showModal === 'function') {
        deleteOrderDialog.showModal();
    } else {
        deleteOrderDialog.setAttribute('open', '');
    }
    cancelDeleteBtn?.focus();
}

function closeDeleteDialog() {
    if (!deleteOrderDialog) return;
    if (typeof deleteOrderDialog.close === 'function') deleteOrderDialog.close();
    else deleteOrderDialog.removeAttribute('open');
}

/** Resolve the database id for shirts cached before ids were stored. */
async function resolveShirtId(order) {
    if (order.shirtId) return order.shirtId;

    const result = await API.request(
        `/api/shirts?reference=${encodeURIComponent(session.reference)}`
    );
    const shirts = Array.isArray(result.shirts) ? result.shirts : [];
    const match = shirts.find(
        s => s.size === order.size && Number(s.qty) === Number(order.qty)
    );
    return match?.id ?? null;
}

async function deleteOrderEverywhere(order, refKey) {
    // Demo data never leaves this browser, so don't call the API for it.
    if (refKey !== DEMO_REF_KEY) {
        const shirtId = await resolveShirtId(order);
        if (!shirtId) {
            throw new Error('This reservation could not be found on the server.');
        }

        try {
            await API.request(`/api/shirts/${encodeURIComponent(shirtId)}`, { method: 'DELETE' });
        } catch (err) {
            // Already deleted elsewhere — still clean up the local copy.
            if (err.status !== 404) throw err;
        }
    }

    const records = getMemberRecords(refKey);
    const index = records.findIndex(r => {
        if (r.type !== 'tshirt') return false;
        if (order.shirtId) return r.shirtId === order.shirtId;
        return r.tshirt?.size === order.size && Number(r.tshirt?.qty) === Number(order.qty);
    });

    if (index === -1) {
        throw new Error('This order is no longer in your cached registrations.');
    }

    saveMemberRecords(refKey, records.filter((_, i) => i !== index));
    forgetOrderState(refKey, order);
}

ordersTableBody?.addEventListener('click', (event) => {
    const button = event.target.closest('.order-delete');
    if (!button) return;

    const order = currentOrders.find(o => o.id === button.dataset.orderId);
    if (order) openDeleteDialog(order);
});

cancelDeleteBtn?.addEventListener('click', closeDeleteDialog);

deleteOrderDialog?.addEventListener('click', (event) => {
    // Click on the backdrop closes, but not while a delete is in flight.
    if (event.target === deleteOrderDialog && !confirmDeleteBtn.disabled) {
        closeDeleteDialog();
    }
});

deleteOrderDialog?.addEventListener('close', () => {
    pendingDelete = null;
    setDeleteBusy(false);
});

confirmDeleteBtn?.addEventListener('click', async () => {
    if (!pendingDelete) return;

    const order = pendingDelete;
    const refKey = refCompareKey(session.refKey);
    setDeleteBusy(true);
    deleteOrderError.classList.add('is-hidden');

    try {
        await deleteOrderEverywhere(order, refKey);

        const records = getMemberRecords(refKey);
        const orders = buildOrders(records, getSavedOrders(refKey));
        saveOrders(refKey, orders);

        closeDeleteDialog();
        renderAll({ session, member: mergeMemberRecords(records), orders });
        showToast(`${order.kind === 'tshirt' ? 'T-shirt order' : 'Order'} removed.`);
    } catch (err) {
        console.error('Could not remove order:', err);
        deleteOrderError.textContent = err.message || 'Could not remove this order. Please try again.';
        deleteOrderError.classList.remove('is-hidden');
        setDeleteBusy(false);
    }
});

/* ── Sign out / print ────────────────────────────────────── */
signOutBtn?.addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = 'login.html';
});
printSummaryBtn?.addEventListener('click', () => window.print());

/* ── Demo data (opt-in preview) ──────────────────────────── */
seedDemoBtn?.addEventListener('click', () => {
    const now = new Date().toISOString();
    const base = {
        fullName: 'Demo Member',
        email: 'demo@example.com',
        contactNumber: '0917 000 0000',
        clubRegion: 'Region XI — Davao Region',
        registeredAt: now,
        reference: DEMO_REFERENCE,
        demo: true,
    };
    const demoRecords = [
        { ...base, type: 'registration', tshirt: null },
        { ...base, type: 'tshirt', tshirt: { size: 'L', qty: 2, nameOnShirt: 'Demo Member' } },
    ];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const existing = raw ? JSON.parse(raw) : [];
        const kept = (Array.isArray(existing) ? existing : []).filter(r => refCompareKey(r?.reference) !== DEMO_REF_KEY);
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...kept, ...demoRecords]));

        const ordersMap = readOrdersMap();
        delete ordersMap[DEMO_REF_KEY];
        writeOrdersMap(ordersMap);

        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            refKey: DEMO_REF_KEY, reference: DEMO_REFERENCE,
            fullName: base.fullName, clubRegion: base.clubRegion, contactNumber: base.contactNumber,
            signedInAt: now,
        }));
        window.location.reload();
    } catch (err) {
        console.warn('Could not seed demo data:', err);
        showToast('Could not create sample data — storage may be unavailable.');
    }
});

clearDemoBtn?.addEventListener('click', () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const existing = raw ? JSON.parse(raw) : [];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(
            (Array.isArray(existing) ? existing : []).filter(r => refCompareKey(r?.reference) !== DEMO_REF_KEY)
        ));
        const ordersMap = readOrdersMap();
        delete ordersMap[DEMO_REF_KEY];
        writeOrdersMap(ordersMap);
    } catch (err) {
        console.warn('Could not clear demo data:', err);
    }
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = 'login.html';
});
