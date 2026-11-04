# Convention API (Express + Supabase)

Base URL during development: `http://localhost:3000`

## Setup

1. Add these values to the root `.env` file:

   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SECRET_KEY=your-service-role-or-secret-key
   ADMIN_KEY=a-long-random-secret-for-the-admin-page
   PORT=3000
   ```

2. Run `backend/sql/schema.sql` in the Supabase SQL Editor to create the
   `users`, `shirts` and `payments` tables — or let the server do it for you.
   Add ONE of these to the root `.env` and the schema is applied automatically
   on every `npm run dev` (existing rows are never touched):

   ```env
   # Option A — Dashboard > Connect > Session pooler
   SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres

   # Option B — Dashboard > Account > Access Tokens
   SUPABASE_ACCESS_TOKEN=sbp_...
   ```

   Without either value the server still starts, checks whether the tables
   exist, and prints instructions if they do not. Run `npm run db` to
   apply the schema without starting the server.

3. Start the server:

   ```bash
   npm run dev
   ```

## Endpoints

### Users

| Method | Path | Body / Params | Purpose |
| --- | --- | --- | --- |
| POST | `/api/users/register` | `{ fullName, username?, contactNumber, clubRegion, password? }` | Create a user and issue a reference number |
| POST | `/api/users/login` | `{ reference, username }` or `{ reference, password }` | Sign in with the issued reference |
| GET | `/api/users/:reference` | reference in the URL | Load a public user profile |

`username` is optional at the API level but is required by the registration
page and must be unique (case-insensitive). `password` is also optional. When
it is supplied (minimum 8 characters) the account must use it to log in.
Without a password, login checks the username (or the registered full name).

`POST /api/users/register` response:

```json
{
  "message": "Registration successful.",
  "user": {
    "id": "uuid",
    "fullName": "Juan Dela Cruz",
    "username": "juandelacruz",
    "contactNumber": "09171234567",
    "clubRegion": "Region XI — Davao Region",
    "reference": "EMC-LX3K9Q2AB-7F2D",
    "createdAt": "2026-01-01T00:00:00.000Z"
  },
  "reference": "EMC-LX3K9Q2AB-7F2D"
}
```

### Shirts

| Method | Path | Body / Params | Purpose |
| --- | --- | --- | --- |
| POST | `/api/shirts` | `{ userId }` or `{ reference }`, plus `{ size, qty, nameOnShirt }` | Reserve a shirt |
| GET | `/api/shirts?userId=<uuid>` | uuid query | List a user's shirts |
| GET | `/api/shirts?reference=<reference>` | reference query | List a user's shirts by reference |
| PATCH | `/api/shirts/:id` | `{ size?, qty?, nameOnShirt? }` | Update a reservation |
| DELETE | `/api/shirts/:id` | shirt id in the URL | Delete a reservation |

Valid sizes: `XS`, `S`, `M`, `L`, `XL`, `2XL`, `3XL`. `nameOnShirt` is the
name printed on the shirt (1–40 characters); the registration page asks for it
when a member reserves a shirt and pre-fills it with their full name.

### Payments

One payment covers all of a member's orders. Submitting again replaces the
single payment row for that member and puts it back in the verification queue.

| Method | Path | Body / Params | Purpose |
| --- | --- | --- | --- |
| POST | `/api/payments` | `{ reference, method, txnRef?, txnDate, receiptImage? }` | Submit or update payment details |
| GET | `/api/payments?reference=<reference>` | reference query | Load a member's payment and verification status |

`method` is one of `GCash`, `Bank Transfer`, or `Cash`. `txnRef` is required
for the first two. `receiptImage` is a base64 image data URL (the dashboard
resizes uploads before sending). The server calculates `amount` from the
registration fee plus the member's shirt reservations.

### Admin (secretariat)

Every `/api/admin` route requires the `X-Admin-Key` header to match
`ADMIN_KEY` in the root `.env`. If `ADMIN_KEY` is unset, the routes return
`503` instead of being public. The admin page is at `pages/admin.html`.

| Method | Path | Body / Params | Purpose |
| --- | --- | --- | --- |
| GET | `/api/admin/session` | header only | Test the admin key |
| GET | `/api/admin/users` | — | List members with derived orders and payment summaries |
| GET | `/api/admin/users/:reference` | reference in URL | One member with orders and the full receipt |
| PATCH | `/api/admin/payments/:id/verify` | `{ status: "verified" \| "rejected" \| "pending", note? }` | Verify, reject, or return a payment to pending |

The admin page has four tabs: **Overview** (totals and the verification
queue), **Users** (searchable member directory), **Orders** (every
registration and t-shirt order), and **Statistics** (shirt totals, payment
status counts and amounts, members per region, and the list of verified
payments). Select **Review** on any member or order to see their profile, order
breakdown, payment details, and receipt image before verifying or rejecting the
payment.

## Notes

- Passwords are hashed with Node's built-in `scrypt`; the plain password is
  never stored or returned. Accounts created without a password fall back to
  full-name verification.
- `SUPABASE_SECRET_KEY` must stay server-side. The frontend calls these
  Express endpoints instead of talking to Supabase directly.
- RLS is enabled on all tables. The secret key bypasses RLS on the server.
- The pages cache the API response in `localStorage` so the dashboard can
  render instantly; Supabase remains the source of truth.
- Payment submissions and verification status live in Supabase so the
  secretariat sees the same data as members. The dashboard still keeps a local
  copy for instant rendering and uploads older local-only payments once.
