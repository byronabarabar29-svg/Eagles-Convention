# Convention API (Express + Supabase)

Base URL during development: `http://localhost:3000`

## Setup

1. Add these values to the root `.env` file:

   ```env
   SUPABASE_URL="your_Url"
   SUPABASE_PUBLISHABLE_KEY="your key"
   SUPABASE_SECRET_KEY="your key"
<<<<<<< HEAD
   ADMIN_KEY="a-long-random-value"
   ```
=======
   SUPABASE_JWKS_URL="your url"
   ADMIN_KEY="planned password"
>>>>>>> d89b0fc0d15e681fb93bee25600ba39193a301fe

2. Start the database:

   ```bash
   npm run db
   ```

3. Start the server:

   ```bash
   npm run dev
   ```


## Notes
- `SUPABASE_SECRET_KEY` must stay server-side. The frontend calls these
  Express endpoints instead of talking to Supabase directly.
- RLS is enabled on all tables. The secret key bypasses RLS on the server.
- The pages cache the API response in `localStorage` so the dashboard can
  render instantly; Supabase remains the source of truth.
- Payment submissions and verification status live in Supabase so the
  secretariat sees the same data as members. The dashboard still keeps a local
  copy for instant rendering and uploads older local-only payments once.

If the database isnt working go to backend/sql
- Copy the schema.sql into supabase sql editor to automatically generate the tables

## Registration confirmation email

Every successful registration sends the member an email with their details and
reference number. Two delivery methods are supported — configure **one** of
them in the root `.env`.

### Option 1: Resend (recommended on Render)

Render commonly blocks outbound SMTP, so the HTTP API is the safer choice.

```env
RESEND_API_KEY="re_your_api_key"
MAIL_FROM="Eagles Convention <secretariat@your-domain.com>"
PUBLIC_SITE_URL="https://your-site.example.com"
```

- Create a free account at <https://resend.com> and copy an API key.
- `MAIL_FROM` must use a verified sender/domain in Resend. While testing you can
  omit it to use `onboarding@resend.dev`, which only delivers to your own
  Resend account address.
- Emails are sent to `https://api.resend.com/emails` over HTTPS, so no ports
  need to be opened.

### Option 2: SMTP

```env
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="your-address@gmail.com"
SMTP_PASS="your-app-password"
MAIL_FROM="Eagles Convention <your-address@gmail.com>"
PUBLIC_SITE_URL="https://your-site.example.com"
```

- `SMTP_SECURE="true"` with port `465` for SSL; use port `587` with `"false"`
  for STARTTLS.
- For Gmail, use a Google **App Password**, not your normal account password.

### Notes

- `RESEND_API_KEY` takes precedence over the SMTP settings when both are set.
- If neither provider is configured, registration still works — the server just
  logs that the email was skipped. Mail failures never block a registration.
- `PUBLIC_SITE_URL` is optional; when set, the email includes a Member Login link.
