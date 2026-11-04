import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

/*
 * Load the root .env file (the project is usually started from the repo root).
 * `quiet` stops dotenv from printing its startup banner.
 */
dotenv.config({ quiet: true })

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
    throw new Error(
        'Missing Supabase configuration. Add SUPABASE_URL and SUPABASE_SECRET_KEY to the root .env file.'
    )
}

/*
 * The secret key is used because this client only runs on the server.
 * Never expose SUPABASE_SECRET_KEY to frontend JavaScript.
 */
export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
    },
})

export const TABLES = Object.freeze({
    users: 'users',
    shirts: 'shirts',
})
