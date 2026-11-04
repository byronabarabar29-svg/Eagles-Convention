# Convention API (Express + Supabase)

Base URL during development: `http://localhost:3000`

## Setup

1. Add these values to the root `.env` file:

   ```env
     SUPABASE_URL="your_Url"
   SUPABASE_PUBLISHABLE_KEY="your key"
   SUPABASE_SECRET_KEY="your key"
   SUPABASE_JWKS_URL="your url"

3. Start the database:

   ```bash
   npm run db
   ```

4. Start the server:

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
