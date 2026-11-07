/* ═══════════════════════════════════════════════════════════
   3rd Eagles Mindanao Convention — Secretariat Admin

   Reviews members, derived orders, payment receipts and the
   verification queue. All data comes from the Express API;
   the admin key is kept in sessionStorage and sent as the
   X-Admin-Key header.
   ═══════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    const API = window.EMCApi;
    const KEY_STORAGE = 'emc-admin-key';

    const $ = (id) => document.getElementById(id);

    const adminLogin      = $('adminLogin');
    const adminApp        = $('adminApp');
    const adminTabs       = $('adminTabs');
    const loginForm       = $('adminLoginForm');
    const adminKeyInput   = $('adminKey');
    const adminKeyError   = $('adminKeyError');
    const loginError      = $('loginError');
    const adminLoginBtn   = $('adminLoginBtn');
    const refreshBtn      = $('refreshBtn');
    const signOutBtn      = $('signOutBtn');
    const lastUpdated     = $('lastUpdated');

    const statUsers       = $('statUsers');
    const statUsersSub    = $('statUsersSub');
    const statOrders      = $('statOrders');
    const statExpected    = $('statExpected');
    const statVerified    = $('statVerified');
    const statVerifiedSub = $('statVerifiedSub');
    const statPending     = $('statPending');
    const statPendingSub  = $('statPendingSub');

    const pendingBody     = $('pendingBody');
    const pendingEmpty    = $('pendingEmpty');
    const pendingPill     = $('pendingPill');

    const userSearch      = $('userSearch');
    const userStatusFilter = $('userStatusFilter');
    const userCount       = $('userCount');
    const usersBody       = $('usersBody');
    const usersEmpty      = $('usersEmpty');

    const orderSearch      = $('orderSearch');
    const orderStatusFilter = $('orderStatusFilter');
    const orderCount       = $('orderCount');
    const ordersBody       = $('ordersBody');
    const ordersEmpty      = $('ordersEmpty');

    const statsPill           = $('statsPill');
    const statsShirtTendered  = $('statsShirtTendered');
    const statsShirtTenderedSub = $('statsShirtTenderedSub');
    const statsShirtValue     = $('statsShirtValue');
    const statsShirtQty       = $('statsShirtQty');
    const statsShirtQtySub    = $('statsShirtQtySub');
    const statsMembers        = $('statsMembers');
    const statsMembersSub     = $('statsMembersSub');
    const statsPaid           = $('statsPaid');
    const statsPaidSub        = $('statsPaidSub');
    const statsPending        = $('statsPending');
    const statsPendingSub     = $('statsPendingSub');
    const statsRejected       = $('statsRejected');
    const statsRejectedSub    = $('statsRejectedSub');
    const statsUnpaid         = $('statsUnpaid');
    const statsUnpaidSub      = $('statsUnpaidSub');
    const regionBody          = $('regionBody');
    const regionEmpty         = $('regionEmpty');
    const paidCount           = $('paidCount');
    const paidBody            = $('paidBody');
    const paidEmpty           = $('paidEmpty');

    const reviewDialog    = $('reviewDialog');
    const reviewContent   = $('reviewContent');
    const receiptDialog   = $('receiptDialog');
    const receiptFullImage = $('receiptFullImage');
    const receiptCloseBtn = $('receiptCloseBtn');
    const toastEl         = $('toast');

    const peso = new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        maximumFractionDigits: 2,
    });

    const STATUS = {
        unpaid:   { label: 'Unpaid',           className: 'status-unpaid' },
        pending:  { label: 'For verification', className: 'status-pending' },
        verified: { label: 'Verified',         className: 'status-verified' },
        rejected: { label: 'Rejected',         className: 'status-rejected' },
    };

    let adminKey = '';
    let loading = false;

    const state = {
        users: [],
        orders: [],
        generatedAt: null,
        view: 'overview',
        userQuery: '',
        userStatus: 'all',
        orderQuery: '',
        orderStatus: 'all',
        review: null,
    };

    /* ── Formatting / escaping ───────────────────────────────── */
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));
    }

    function money(value) {
        return peso.format(Number(value) || 0);
    }

    function formatDateOnly(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
        if (!match) return formatDate(value);

        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        return Number.isNaN(date.getTime())
            ? '—'
            : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function formatDate(value) {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? '—'
            : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function formatDateTime(value) {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? '—'
            : date.toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
            });
    }

    function initialsOf(name) {
        const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) return 'M';
        const first = parts[0][0] ?? '';
        const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
        return (first + last).toUpperCase();
    }

    function statusPill(status) {
        const meta = STATUS[status] ?? STATUS.unpaid;
        return `<span class="status-pill ${meta.className}">${meta.label}</span>`;
    }

    function receiptBadge(payment) {
        return payment?.hasReceipt
            ? '<span class="badge-soft is-on">Uploaded</span>'
            : '<span class="badge-soft is-off">None</span>';
    }

    function memberCell(name, sub) {
        return `
            <div class="member-cell">
                <span class="member-avatar" aria-hidden="true">${escapeHtml(initialsOf(name))}</span>
                <div>
                    <div class="member-name">${escapeHtml(name || 'Member')}</div>
                    <div class="member-sub">${escapeHtml(sub || '')}</div>
                </div>
            </div>`;
    }

    /* ── Toast ───────────────────────────────────────────────── */
    let toastTimer;
    function showToast(message) {
        toastEl.textContent = message;
        toastEl.classList.add('is-visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 4500);
    }

    /* ── Storage / request helpers ───────────────────────────── */
    function readStoredKey() {
        try { return sessionStorage.getItem(KEY_STORAGE) ?? ''; } catch { return ''; }
    }
    function storeKey(value) {
        try { sessionStorage.setItem(KEY_STORAGE, value); } catch { /* ignore */ }
    }
    function clearKey() {
        try { sessionStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
    }

    function adminRequest(path, options = {}) {
        return API.request(path, {
            ...options,
            headers: {
                ...(options.headers ?? {}),
                'X-Admin-Key': adminKey,
            },
        });
    }

    /* ── Login gate ──────────────────────────────────────────── */
    function setLoginError(message) {
        loginError.textContent = message ?? '';
        loginError.classList.toggle('is-hidden', !message);
    }

    function setKeyError(message) {
        adminKeyError.textContent = message ?? '';
        adminKeyInput.setAttribute('aria-invalid', message ? 'true' : 'false');
    }

    function setLoginBusy(busy) {
        adminLoginBtn.disabled = busy;
        adminKeyInput.disabled = busy;
        adminLoginBtn.textContent = busy ? 'Checking…' : 'Unlock dashboard';
    }

    function showLogin(message) {
        adminLogin.classList.remove('is-hidden');
        adminApp.classList.add('is-hidden');
        adminTabs.classList.add('is-hidden');
        refreshBtn.classList.add('is-hidden');
        signOutBtn.classList.add('is-hidden');
        setLoginError(message ?? '');
        setKeyError('');
        adminKeyInput.value = '';
        adminKeyInput.focus();
    }

    function showApp() {
        adminLogin.classList.add('is-hidden');
        adminApp.classList.remove('is-hidden');
        adminTabs.classList.remove('is-hidden');
        refreshBtn.classList.remove('is-hidden');
        signOutBtn.classList.remove('is-hidden');
        setLoginError('');
    }

    function setLoading(value) {
        loading = value;
        refreshBtn.disabled = value;
        refreshBtn.textContent = value ? 'Loading…' : 'Refresh';
    }

    /* ── Data loading ────────────────────────────────────────── */
    function flattenOrders(users) {
        return users.flatMap((user) => user.orders.map((order) => ({
            ...order,
            member: {
                fullName: user.fullName,
                username: user.username,
                reference: user.reference,
                rawReference: user.rawReference,
                contactNumber: user.contactNumber,
                clubRegion: user.clubRegion,
            },
            payment: user.payment,
            userStatus: user.status,
        })));
    }

    async function loadData({ silent = false } = {}) {
        if (loading) return;

        setLoading(true);

        try {
            const result = await adminRequest('/api/admin/users');

            state.users = Array.isArray(result.users) ? result.users : [];
            state.orders = flattenOrders(state.users);
            state.generatedAt = result.generatedAt ?? new Date().toISOString();

            showApp();
            renderAll();

            if (!silent) {
                showToast(`Loaded ${state.users.length} member${state.users.length === 1 ? '' : 's'}.`);
            }
        } catch (err) {
            console.error('Could not load admin data:', err);

            if (err.status === 401) {
                clearKey();
                adminKey = '';
                showLogin('Your admin key is not valid. Sign in again.');
            } else if (err.status === 503) {
                showLogin(err.message || 'Admin access is not configured on the server.');
            } else {
                showToast(err.message || 'Could not load the admin data.');
                if (state.users.length === 0) {
                    showLogin(err.message || 'Could not load the admin data.');
                }
            }
        } finally {
            setLoading(false);
        }
    }

    /* ── Overview ────────────────────────────────────────────── */
    function renderOverview() {
        const users = state.users;
        const orders = state.orders;

        const expected = users.reduce((sum, user) => sum + user.ordersTotal, 0);
        const verifiedUsers = users.filter((user) => user.status === 'verified');
        const pendingUsers = users.filter((user) => user.status === 'pending')
            .sort((a, b) => (
                new Date(b.payment?.submittedAt ?? 0) - new Date(a.payment?.submittedAt ?? 0)
            ));
        const rejectedUsers = users.filter((user) => user.status === 'rejected');

        const verifiedAmount = verifiedUsers.reduce((sum, user) => sum + user.ordersTotal, 0);
        const pendingAmount = pendingUsers.reduce((sum, user) => sum + user.ordersTotal, 0);

        statUsers.textContent = String(users.length);
        statUsersSub.textContent = `${verifiedUsers.length} verified · ${rejectedUsers.length} rejected · ${pendingUsers.length} pending`;

        statOrders.textContent = String(orders.length);
        statExpected.textContent = money(expected);

        statVerified.textContent = money(verifiedAmount);
        statVerifiedSub.textContent = `${verifiedUsers.length} payment${verifiedUsers.length === 1 ? '' : 's'}`;

        statPending.textContent = String(pendingUsers.length);
        statPendingSub.textContent = pendingAmount > 0
            ? `${money(pendingAmount)} waiting`
            : 'no amount waiting';

        lastUpdated.textContent = state.generatedAt
            ? `Updated ${new Date(state.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
            : 'Not loaded';

        pendingPill.textContent = `${pendingUsers.length} pending`;

        if (pendingUsers.length === 0) {
            pendingBody.innerHTML = '';
            pendingEmpty.classList.remove('is-hidden');
        } else {
            pendingEmpty.classList.add('is-hidden');
            pendingBody.innerHTML = pendingUsers.map((user) => `
                <tr>
                    <td>${memberCell(user.fullName, user.username ? `@${user.username}` : 'Member')}</td>
                    <td><span class="ref-code">${escapeHtml(user.reference)}</span></td>
                    <td class="col-total nowrap">${money(user.payment?.amount ?? user.ordersTotal)}</td>
                    <td>${escapeHtml(user.payment?.method ?? '—')}</td>
                    <td class="nowrap">${formatDateTime(user.payment?.submittedAt)}</td>
                    <td>${receiptBadge(user.payment)}</td>
                    <td class="col-actions">
                        <button type="button" class="admin-link" data-review="${escapeHtml(user.rawReference)}">Review</button>
                    </td>
                </tr>`).join('');
        }
    }

    /* ── Users ───────────────────────────────────────────────── */
    function filteredUsers() {
        const query = state.userQuery.trim().toLowerCase();

        return state.users.filter((user) => {
            if (state.userStatus !== 'all' && user.status !== state.userStatus) return false;
            if (!query) return true;

            return [
                user.fullName,
                user.username,
                user.email,
                user.reference,
                user.rawReference,
                user.contactNumber,
                user.clubRegion,
            ].some((value) => String(value ?? '').toLowerCase().includes(query));
        });
    }

    function renderUsers() {
        const filtered = filteredUsers();

        userCount.textContent = filtered.length === state.users.length
            ? `${state.users.length} member${state.users.length === 1 ? '' : 's'}`
            : `${filtered.length} of ${state.users.length} members`;

        if (filtered.length === 0) {
            usersBody.innerHTML = '';
            usersEmpty.classList.remove('is-hidden');
            return;
        }

        usersEmpty.classList.add('is-hidden');
        usersBody.innerHTML = filtered.map((user) => `
            <tr>
                <td>${memberCell(user.fullName, user.username ? `@${user.username}` : 'No username')}</td>
                <td><span class="ref-code">${escapeHtml(user.reference)}</span></td>
                <td class="email-cell">${escapeHtml(user.email ?? '—')}</td>
                <td class="nowrap">${escapeHtml(user.contactNumber ?? '—')}</td>
                <td>${escapeHtml(user.clubRegion ?? '—')}</td>
                <td class="col-qty">${user.orderCount}</td>
                <td class="col-total nowrap">${money(user.ordersTotal)}</td>
                <td>${statusPill(user.status)}</td>
                <td class="col-actions">
                    <button type="button" class="admin-link" data-review="${escapeHtml(user.rawReference)}">View details</button>
                </td>
            </tr>`).join('');
    }

    /* ── Orders ──────────────────────────────────────────────── */
    function filteredOrders() {
        const query = state.orderQuery.trim().toLowerCase();

        return state.orders.filter((order) => {
            if (state.orderStatus !== 'all' && order.status !== state.orderStatus) return false;
            if (!query) return true;

            return [
                order.orderNo,
                order.title,
                order.subtitle,
                order.member.fullName,
                order.member.username,
                order.member.reference,
                order.payment?.method,
                order.payment?.txnRef,
            ].some((value) => String(value ?? '').toLowerCase().includes(query));
        });
    }

    function renderOrders() {
        const filtered = filteredOrders();

        orderCount.textContent = filtered.length === state.orders.length
            ? `${state.orders.length} order${state.orders.length === 1 ? '' : 's'}`
            : `${filtered.length} of ${state.orders.length} orders`;

        if (filtered.length === 0) {
            ordersBody.innerHTML = '';
            ordersEmpty.classList.remove('is-hidden');
            return;
        }

        ordersEmpty.classList.add('is-hidden');
        ordersBody.innerHTML = filtered.map((order) => `
            <tr>
                <td><span class="ref-code">${escapeHtml(order.orderNo)}</span></td>
                <td>${memberCell(order.member.fullName, order.member.reference)}</td>
                <td>
                    <div class="order-title">${escapeHtml(order.title)}</div>
                    <div class="order-sub">${escapeHtml(order.subtitle)}</div>
                </td>
                <td class="col-qty">${order.qty}</td>
                <td class="col-total nowrap">${money(order.total)}</td>
                <td>
                    ${order.payment
                        ? `<div class="order-title">${escapeHtml(order.payment.method)}</div>
                           <div class="order-sub mono">${escapeHtml(order.payment.txnRef ?? 'No reference')}</div>`
                        : '<span class="muted">Not submitted</span>'}
                </td>
                <td>${statusPill(order.status)}</td>
                <td class="col-actions">
                    <button type="button" class="admin-link" data-review="${escapeHtml(order.member.rawReference)}">Review</button>
                </td>
            </tr>`).join('');
    }

    /* ── Statistics ──────────────────────────────────────────── */
    function shirtOrdersOf(user) {
        return (user.orders ?? []).filter((order) => order.kind === 'tshirt');
    }

    function sumQty(orders) {
        return orders.reduce((sum, order) => sum + (Number(order.qty) || 0), 0);
    }

    function sumAmount(orders) {
        return orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    }

    function memberStatus(user) {
        return ['verified', 'pending', 'rejected'].includes(user.status)
            ? user.status
            : 'unpaid';
    }

    function renderStatistics() {
        const users = state.users;
        const shirtOrders = new Map(
            users.map((user) => [user.id, shirtOrdersOf(user)])
        );
        const allShirtOrders = users.flatMap((user) => shirtOrders.get(user.id));

        const byStatus = {
            verified: users.filter((user) => memberStatus(user) === 'verified'),
            pending: users.filter((user) => memberStatus(user) === 'pending'),
            rejected: users.filter((user) => memberStatus(user) === 'rejected'),
            unpaid: users.filter((user) => memberStatus(user) === 'unpaid'),
        };

        const statusTotal = (status) => byStatus[status]
            .reduce((sum, user) => {
                const amount = status === 'unpaid'
                    ? user.ordersTotal
                    : (user.payment?.amount ?? user.ordersTotal);

                return sum + (Number(amount) || 0);
            }, 0);

        const verifiedShirtOrders = byStatus.verified
            .flatMap((user) => shirtOrders.get(user.id));
        const totalShirtQty = sumQty(allShirtOrders);
        const totalShirtValue = sumAmount(allShirtOrders);
        const verifiedShirtQty = sumQty(verifiedShirtOrders);
        const verifiedShirtValue = sumAmount(verifiedShirtOrders);
        const membersWithShirts = users
            .filter((user) => (shirtOrders.get(user.id) ?? []).length > 0)
            .length;

        statsMembers.textContent = String(users.length);
        statsMembersSub.textContent = users.length === 0
            ? 'no registrations yet'
            : `${byStatus.verified.length} paid · ${byStatus.unpaid.length} unpaid`;

        statsShirtQty.textContent = totalShirtQty.toLocaleString('en-PH');
        statsShirtQtySub.textContent = `across ${membersWithShirts} member${membersWithShirts === 1 ? '' : 's'}`;

        statsShirtValue.textContent = money(totalShirtValue);
        statsShirtTendered.textContent = money(verifiedShirtValue);
        statsShirtTenderedSub.textContent = `${verifiedShirtQty} shirt${verifiedShirtQty === 1 ? '' : 's'} in verified payments`;

        statsPaid.textContent = String(byStatus.verified.length);
        statsPaidSub.textContent = `${money(statusTotal('verified'))} verified`;

        statsPending.textContent = String(byStatus.pending.length);
        statsPendingSub.textContent = `${money(statusTotal('pending'))} waiting`;

        statsRejected.textContent = String(byStatus.rejected.length);
        statsRejectedSub.textContent = `${money(statusTotal('rejected'))} rejected`;

        statsUnpaid.textContent = String(byStatus.unpaid.length);
        statsUnpaidSub.textContent = `${money(statusTotal('unpaid'))} outstanding`;

        statsPill.textContent = `${byStatus.verified.length} paid`;

        renderRegionStats(users, shirtOrders);
        renderPaidUsers(byStatus.verified, shirtOrders);
    }

    function renderRegionStats(users, shirtOrders) {
        const regions = new Map();

        for (const user of users) {
            const key = user.clubRegion || 'Unspecified region';
            const row = regions.get(key) ?? {
                region: key,
                members: 0,
                shirts: 0,
                shirtValue: 0,
                verified: 0,
                pending: 0,
                rejected: 0,
                unpaid: 0,
            };

            const orders = shirtOrders.get(user.id) ?? [];

            row.members += 1;
            row.shirts += sumQty(orders);
            row.shirtValue += sumAmount(orders);
            row[memberStatus(user)] += 1;

            regions.set(key, row);
        }

        const rows = [...regions.values()].sort((a, b) => (
            b.members - a.members || a.region.localeCompare(b.region)
        ));

        if (rows.length === 0) {
            regionBody.innerHTML = '';
            regionEmpty.classList.remove('is-hidden');
            return;
        }

        regionEmpty.classList.add('is-hidden');
        regionBody.innerHTML = rows.map((row) => `
            <tr>
                <td><span class="member-name">${escapeHtml(row.region)}</span></td>
                <td class="col-qty">${row.members}</td>
                <td class="col-qty">${row.shirts}</td>
                <td class="col-total nowrap">${money(row.shirtValue)}</td>
                <td class="col-qty">${row.verified}</td>
                <td class="col-qty">${row.pending}</td>
                <td class="col-qty">${row.rejected}</td>
                <td class="col-qty">${row.unpaid}</td>
            </tr>`).join('');
    }

    function renderPaidUsers(paidUsers, shirtOrders) {
        const rows = [...paidUsers].sort((a, b) => (
            new Date(b.payment?.verifiedAt ?? b.payment?.submittedAt ?? 0) -
            new Date(a.payment?.verifiedAt ?? a.payment?.submittedAt ?? 0)
        ));

        paidCount.textContent = `${rows.length} paid`;

        if (rows.length === 0) {
            paidBody.innerHTML = '';
            paidEmpty.classList.remove('is-hidden');
            return;
        }

        paidEmpty.classList.add('is-hidden');
        paidBody.innerHTML = rows.map((user) => {
            const orders = shirtOrders.get(user.id) ?? [];
            const shirtQty = sumQty(orders);
            const shirtValue = sumAmount(orders);

            return `
                <tr>
                    <td>${memberCell(user.fullName, user.username ? `@${user.username}` : user.reference)}</td>
                    <td>${escapeHtml(user.clubRegion ?? '—')}</td>
                    <td class="col-qty">${shirtQty}</td>
                    <td class="col-total nowrap">${money(shirtValue)}</td>
                    <td class="col-total nowrap">${money(user.payment?.amount ?? user.ordersTotal)}</td>
                    <td>${escapeHtml(user.payment?.method ?? '—')}</td>
                    <td class="nowrap">${formatDateTime(user.payment?.verifiedAt ?? user.payment?.submittedAt)}</td>
                    <td class="col-actions">
                        <button type="button" class="admin-link" data-review="${escapeHtml(user.rawReference)}">Review</button>
                    </td>
                </tr>`;
        }).join('');
    }

    function renderAll() {
        renderOverview();
        renderUsers();
        renderOrders();
        renderStatistics();
    }

    /* ── Review dialog ───────────────────────────────────────── */
    function closeReview() {
        if (typeof reviewDialog.close === 'function' && reviewDialog.open) {
            reviewDialog.close();
        } else {
            reviewDialog.removeAttribute('open');
        }
    }

    function openReceipt() {
        const url = state.review?.payment?.receiptImage;

        if (!url) {
            showToast('No receipt uploaded for this payment.');
            return;
        }

        receiptFullImage.src = url;
        if (typeof receiptDialog.showModal === 'function') {
            receiptDialog.showModal();
        } else {
            receiptDialog.setAttribute('open', '');
        }
    }

    function closeReceipt() {
        if (typeof receiptDialog.close === 'function' && receiptDialog.open) {
            receiptDialog.close();
        } else {
            receiptDialog.removeAttribute('open');
        }
    }

    /** A key can be rotated or removed while the dashboard is already open. */
    function handleAuthFailure(err) {
        if (err.status !== 401 && err.status !== 503) return false;

        closeReview();
        closeReceipt();

        if (err.status === 401) {
            clearKey();
            adminKey = '';
            showLogin('Your admin key is not valid. Sign in again.');
        } else {
            showLogin(err.message || 'Admin access is not configured on the server.');
        }

        return true;
    }

    async function openReview(reference) {
        state.review = null;
        reviewContent.innerHTML = '<p class="review-loading">Loading member details…</p>';

        if (typeof reviewDialog.showModal === 'function') {
            if (!reviewDialog.open) reviewDialog.showModal();
        } else {
            reviewDialog.setAttribute('open', '');
        }

        try {
            const result = await adminRequest(`/api/admin/users/${encodeURIComponent(reference)}`);
            state.review = result.user;
            renderReview(result.user);
        } catch (err) {
            console.error('Could not load member details:', err);

            if (handleAuthFailure(err)) return;

            reviewContent.innerHTML = `
                <div class="review-head">
                    <div class="review-head-text">
                        <span class="review-eyebrow">Could not load</span>
                        <h2 class="review-name" id="reviewTitle">Member details</h2>
                        <p class="review-sub">${escapeHtml(err.message || 'Please try again.')}</p>
                    </div>
                    <div class="review-head-side">
                        <button type="button" class="review-close" data-close-review aria-label="Close">&times;</button>
                    </div>
                </div>`;
        }
    }

    function reviewOrdersTable(user) {
        return `
            <div class="table-wrap">
                <table class="admin-table review-table">
                    <thead>
                        <tr>
                            <th scope="col">Order No.</th>
                            <th scope="col">Item</th>
                            <th scope="col" class="col-qty">Qty</th>
                            <th scope="col" class="col-total">Total</th>
                            <th scope="col">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${user.orders.map((order) => `
                            <tr>
                                <td><span class="ref-code">${escapeHtml(order.orderNo)}</span></td>
                                <td>
                                    <div class="order-title">${escapeHtml(order.title)}</div>
                                    <div class="order-sub">${escapeHtml(order.subtitle)}</div>
                                </td>
                                <td class="col-qty">${order.qty}</td>
                                <td class="col-total nowrap">${money(order.total)}</td>
                                <td>${statusPill(order.status)}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    function paymentSection(user) {
        const payment = user.payment;

        if (!payment) {
            return `
                <section class="review-section" aria-labelledby="paymentTitle">
                    <div class="review-section-head">
                        <h3 id="paymentTitle">Payment</h3>
                    </div>
                    <div class="payment-card is-missing">
                        <strong>No payment submitted yet</strong>
                        <span>Ask the member to submit their payment details from the member dashboard.</span>
                    </div>
                </section>`;
        }

        const amountMismatch = Number(payment.amount) !== Number(user.ordersTotal);
        const receipt = payment.receiptImage;

        return `
            <section class="review-section" aria-labelledby="paymentTitle">
                <div class="review-section-head">
                    <h3 id="paymentTitle">Payment</h3>
                    ${statusPill(payment.status)}
                </div>

                <div class="payment-card">
                    <div class="payment-top">
                        <div>
                            <span class="payment-field-label">Submitted amount</span>
                            <div class="payment-amount">${money(payment.amount)}</div>
                        </div>
                        <div class="payment-field">
                            <span class="payment-field-label">Order total</span>
                            <span class="payment-field-value">${money(user.ordersTotal)}</span>
                        </div>
                    </div>

                    ${amountMismatch ? `
                        <div class="payment-warning">
                            The submitted amount does not match the current order total. Check the receipt and orders before verifying.
                        </div>` : ''}

                    <div class="payment-grid">
                        <div class="payment-field">
                            <span class="payment-field-label">Method</span>
                            <span class="payment-field-value">${escapeHtml(payment.method)}</span>
                        </div>
                        <div class="payment-field">
                            <span class="payment-field-label">Transaction ref.</span>
                            <span class="payment-field-value mono">${escapeHtml(payment.txnRef ?? '—')}</span>
                        </div>
                        <div class="payment-field">
                            <span class="payment-field-label">Payment date</span>
                            <span class="payment-field-value">${formatDateOnly(payment.txnDate)}</span>
                        </div>
                        <div class="payment-field">
                            <span class="payment-field-label">Submitted</span>
                            <span class="payment-field-value">${formatDateTime(payment.submittedAt)}</span>
                        </div>
                        <div class="payment-field">
                            <span class="payment-field-label">Verified</span>
                            <span class="payment-field-value">${payment.verifiedAt ? formatDateTime(payment.verifiedAt) : '—'}</span>
                        </div>
                    </div>

                    ${payment.note ? `
                        <div class="payment-field">
                            <span class="payment-field-label">Current note</span>
                            <span class="payment-field-value">${escapeHtml(payment.note)}</span>
                        </div>` : ''}

                    <div class="receipt-preview">
                        ${receipt
                            ? `<button type="button" class="receipt-thumb-btn" data-receipt aria-label="Open full-size receipt">
                                   <img src="${escapeHtml(receipt)}" alt="Payment receipt thumbnail">
                               </button>
                               <div class="receipt-preview-text">
                                   <strong>Receipt uploaded</strong>
                                   <span>Click the thumbnail to view it full size.</span>
                               </div>`
                            : '<div class="receipt-missing">No receipt image uploaded with this payment. Verify using the transaction reference if needed.</div>'}
                    </div>

                    <div class="review-note">
                        <label for="reviewNote">Verification note <span class="muted">(optional)</span></label>
                        <textarea id="reviewNote" maxlength="500" placeholder="Reason for rejection, or a note for the secretariat…">${escapeHtml(payment.note ?? '')}</textarea>
                    </div>

                    <div class="review-actions">
                        <button type="button" class="btn btn-ghost-dark btn-sm" data-close-review>Close</button>
                        ${payment.status !== 'pending'
                            ? '<button type="button" class="btn btn-ghost-dark btn-sm" data-verify="pending">Return to pending</button>'
                            : ''}
                        ${payment.status !== 'rejected'
                            ? '<button type="button" class="btn btn-danger btn-sm" data-verify="rejected">Reject</button>'
                            : ''}
                        ${payment.status !== 'verified'
                            ? '<button type="button" class="btn btn-success btn-sm" data-verify="verified">Verify payment</button>'
                            : ''}
                    </div>
                </div>
            </section>`;
    }

    function renderReview(user) {
        reviewContent.innerHTML = `
            <div class="review-head">
                <div class="review-avatar" aria-hidden="true">${escapeHtml(initialsOf(user.fullName))}</div>
                <div class="review-head-text">
                    <span class="review-eyebrow">Member review</span>
                    <h2 class="review-name" id="reviewTitle">${escapeHtml(user.fullName)}</h2>
                    <p class="review-sub">
                        ${user.username ? `@${escapeHtml(user.username)} · ` : ''}
                        <code>${escapeHtml(user.reference)}</code>
                    </p>
                </div>
                <div class="review-head-side">
                    ${statusPill(user.status)}
                    <button type="button" class="review-close" data-close-review aria-label="Close review">&times;</button>
                </div>
            </div>

            <section class="review-section" aria-labelledby="reviewProfileTitle">
                <div class="review-section-head">
                    <h3 id="reviewProfileTitle">Registration details</h3>
                </div>
                <div class="review-grid">
                    <div class="review-meta">
                        <span class="review-meta-label">Full name</span>
                        <span class="review-meta-value">${escapeHtml(user.fullName ?? '—')}</span>
                    </div>
                    <div class="review-meta">
                        <span class="review-meta-label">Username</span>
                        <span class="review-meta-value">${user.username ? `@${escapeHtml(user.username)}` : '—'}</span>
                    </div>
                    <div class="review-meta">
                        <span class="review-meta-label">Email</span>
                        <span class="review-meta-value">${escapeHtml(user.email ?? '—')}</span>
                    </div>
                    <div class="review-meta">
                        <span class="review-meta-label">Contact number</span>
                        <span class="review-meta-value">${escapeHtml(user.contactNumber ?? '—')}</span>
                    </div>
                    <div class="review-meta">
                        <span class="review-meta-label">Club region</span>
                        <span class="review-meta-value">${escapeHtml(user.clubRegion ?? '—')}</span>
                    </div>
                    <div class="review-meta">
                        <span class="review-meta-label">Reference</span>
                        <span class="review-meta-value mono">${escapeHtml(user.reference)}</span>
                    </div>
                    <div class="review-meta">
                        <span class="review-meta-label">Registered</span>
                        <span class="review-meta-value">${formatDate(user.createdAt)}</span>
                    </div>
                    <div class="review-meta">
                        <span class="review-meta-label">Orders</span>
                        <span class="review-meta-value">${user.orderCount}</span>
                    </div>
                    <div class="review-meta">
                        <span class="review-meta-label">Order total</span>
                        <span class="review-meta-value">${money(user.ordersTotal)}</span>
                    </div>
                </div>
            </section>

            <section class="review-section" aria-labelledby="reviewOrdersTitle">
                <div class="review-section-head">
                    <h3 id="reviewOrdersTitle">Orders</h3>
                    <span class="admin-pill">${user.orderCount} order${user.orderCount === 1 ? '' : 's'}</span>
                </div>
                ${reviewOrdersTable(user)}
            </section>

            ${paymentSection(user)}
        `;
    }

    async function verifyPayment(status, button) {
        const user = state.review;
        const payment = user?.payment;

        if (!payment?.id) {
            showToast('This member has no submitted payment to verify.');
            return;
        }

        const noteEl = $('reviewNote');
        const note = noteEl ? noteEl.value.trim() : '';

        const buttons = reviewContent.querySelectorAll('[data-verify]');
        buttons.forEach((btn) => { btn.disabled = true; });
        if (button) button.textContent = 'Saving…';

        try {
            const result = await adminRequest(
                `/api/admin/payments/${encodeURIComponent(payment.id)}/verify`,
                { method: 'PATCH', body: { status, note } }
            );

            showToast(result.message || 'Payment updated.');
            await loadData({ silent: true });

            if (user.rawReference) {
                await openReview(user.rawReference);
            }
        } catch (err) {
            console.error('Could not verify payment:', err);

            if (handleAuthFailure(err)) return;

            showToast(err.message || 'Could not update the payment.');
            renderReview(user);
        }
    }

    /* ── View switching / filters ────────────────────────────── */
    function setView(view) {
        state.view = view;

        document.querySelectorAll('.admin-tab').forEach((tab) => {
            const active = tab.dataset.view === view;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-current', active ? 'page' : 'false');
        });

        document.querySelectorAll('.admin-view').forEach((section) => {
            section.classList.toggle('is-hidden', section.id !== `view-${view}`);
        });
    }

    function resetFilters() {
        state.userQuery = '';
        state.userStatus = 'all';
        state.orderQuery = '';
        state.orderStatus = 'all';

        if (userSearch) userSearch.value = '';
        if (userStatusFilter) userStatusFilter.value = 'all';
        if (orderSearch) orderSearch.value = '';
        if (orderStatusFilter) orderStatusFilter.value = 'all';
    }

    /* ── Event wiring ────────────────────────────────────────── */
    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const key = adminKeyInput.value.trim();

        if (!key) {
            setKeyError('Enter the admin key.');
            adminKeyInput.focus();
            return;
        }

        setKeyError('');
        setLoginError('');
        adminKey = key;
        setLoginBusy(true);

        try {
            await adminRequest('/api/admin/session');
            storeKey(key);
            await loadData({ silent: true });
        } catch (err) {
            console.error('Admin sign in failed:', err);
            adminKey = readStoredKey();

            if (err.status === 401) {
                clearKey();
                adminKey = '';
                setKeyError('That admin key was not accepted.');
            } else if (err.status === 503) {
                setLoginError(err.message || 'Admin access is not configured on the server.');
            } else {
                setLoginError(err.message || 'Could not sign in. Please try again.');
            }
        } finally {
            setLoginBusy(false);
        }
    });

    adminKeyInput.addEventListener('input', () => {
        if (adminKeyInput.getAttribute('aria-invalid') === 'true') setKeyError('');
    });

    refreshBtn.addEventListener('click', () => loadData({ silent: false }));

    signOutBtn.addEventListener('click', () => {
        clearKey();
        adminKey = '';
        state.users = [];
        state.orders = [];
        state.generatedAt = null;
        state.review = null;
        resetFilters();
        showLogin();
        showToast('Signed out of the admin dashboard.');
    });

    document.querySelectorAll('.admin-tab').forEach((tab) => {
        tab.addEventListener('click', () => setView(tab.dataset.view));
    });

    userSearch.addEventListener('input', () => {
        state.userQuery = userSearch.value;
        renderUsers();
    });

    userStatusFilter.addEventListener('change', () => {
        state.userStatus = userStatusFilter.value;
        renderUsers();
    });

    orderSearch.addEventListener('input', () => {
        state.orderQuery = orderSearch.value;
        renderOrders();
    });

    orderStatusFilter.addEventListener('change', () => {
        state.orderStatus = orderStatusFilter.value;
        renderOrders();
    });

    document.addEventListener('click', (event) => {
        const reviewButton = event.target.closest('[data-review]');
        if (reviewButton) {
            event.preventDefault();
            openReview(reviewButton.dataset.review);
            return;
        }

        const receiptButton = event.target.closest('[data-receipt]');
        if (receiptButton) {
            event.preventDefault();
            openReceipt();
        }
    });

    reviewDialog.addEventListener('click', (event) => {
        if (event.target === reviewDialog) {
            closeReview();
            return;
        }

        if (event.target.closest('[data-close-review]')) {
            closeReview();
            return;
        }

        const verifyButton = event.target.closest('[data-verify]');
        if (verifyButton) {
            verifyPayment(verifyButton.dataset.verify, verifyButton);
        }
    });

    reviewDialog.addEventListener('close', () => {
        state.review = null;
        reviewContent.innerHTML = '';
    });

    receiptDialog.addEventListener('click', (event) => {
        if (event.target === receiptDialog) closeReceipt();
    });

    receiptCloseBtn.addEventListener('click', closeReceipt);

    receiptDialog.addEventListener('close', () => {
        receiptFullImage.removeAttribute('src');
    });

    /* ── Boot ────────────────────────────────────────────────── */
    async function bootstrap() {
        adminKey = readStoredKey();

        if (!adminKey) {
            showLogin();
            return;
        }

        try {
            await adminRequest('/api/admin/session');
            await loadData({ silent: true });
        } catch (err) {
            if (err.status === 401) {
                clearKey();
                adminKey = '';
                showLogin('Your saved admin key is no longer valid. Sign in again.');
            } else if (err.status === 503) {
                showLogin(err.message || 'Admin access is not configured on the server.');
            } else {
                showLogin(err.message || 'Could not reach the server.');
            }
        }
    }

    bootstrap();
})();
