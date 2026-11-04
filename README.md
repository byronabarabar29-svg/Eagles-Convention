# Convention API (Express + Supabase)

Base URL during development: `http://localhost:3000`

## Setup

1. Add these values to the root `.env` file:

   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SECRET_KEY=your-service-role-or-secret-key
   PORT=3000
   ```

2. Run `backend/sql/schema.sql` in the Supabase SQL Editor to create the
   `users` and `shirts` tables — or let the server do it for you. Add ONE of
   these to the root `.env` and the schema is applied automatically on every
   `npm run dev` (existing rows are never touched):

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
| POST | `/api/shirts` | `{ userId }` or `{ reference }`, plus `{ size, qty }` | Reserve a shirt |
| GET | `/api/shirts?userId=<uuid>` | uuid query | List a user's shirts |
| GET | `/api/shirts?reference=<reference>` | reference query | List a user's shirts by reference |
| PATCH | `/api/shirts/:id` | `{ size?, qty? }` | Update a reservation |
| DELETE | `/api/shirts/:id` | shirt id in the URL | Delete a reservation |

Valid sizes: `XS`, `S`, `M`, `L`, `XL`, `2XL`, `3XL`.

## Notes

- Passwords are hashed with Node's built-in `scrypt`; the plain password is
  never stored or returned. Accounts created without a password fall back to
  full-name verification.
- `SUPABASE_SECRET_KEY` must stay server-side. The frontend calls these
  Express endpoints instead of talking to Supabase directly.
- RLS is enabled on both tables. The secret key bypasses RLS on the server.
- The pages cache the API response in `localStorage` so the dashboard can
  render instantly; Supabase remains the source of truth.
