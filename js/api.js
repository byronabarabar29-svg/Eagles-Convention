/* ═══════════════════════════════════════════════════════════
   Shared API helper for the Express + Supabase backend.
   Set window.EMC_API_BASE before loading this file to point at a
   different server (defaults to http://localhost:3000).
   ═══════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    const API_BASE = window.EMC_API_BASE || 'http://localhost:3000';

    class ApiError extends Error {
        constructor(message, status = 0, data = null) {
            super(message);
            this.name = 'ApiError';
            this.status = status;
            this.data = data;
            this.errors = data?.errors ?? null;
        }
    }

    async function request(path, options = {}) {
        const { method = 'GET', body, timeout = 15000 } = options;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
            let response;

            try {
                response = await fetch(API_BASE + path, {
                    method,
                    headers: body === undefined
                        ? undefined
                        : { 'Content-Type': 'application/json' },
                    body: body === undefined ? undefined : JSON.stringify(body),
                    signal: controller.signal,
                });
            } catch (err) {
                if (err.name === 'AbortError') {
                    throw new ApiError('The server took too long to respond. Please try again.');
                }
                throw new ApiError(`Cannot reach the server at ${API_BASE}. Make sure the backend is running.`);
            }

            let data = null;
            const contentType = response.headers.get('content-type') || '';

            if (contentType.includes('application/json')) {
                try { data = await response.json(); } catch { data = null; }
            }

            if (!response.ok) {
                throw new ApiError(
                    data?.message || `Request failed (${response.status}).`,
                    response.status,
                    data
                );
            }

            return data;
        } finally {
            clearTimeout(timer);
        }
    }

    window.EMCApi = { baseUrl: API_BASE, request, ApiError };
})();
