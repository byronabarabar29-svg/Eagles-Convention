import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import dotenv from 'dotenv'

import { supabase } from '../db.js'

/*
 * Runs backend/sql/schema.sql on server start so `npm run dev` always has the
 * tables it needs. The script is idempotent (`create ... if not exists`), so it
 * never deletes users or shirt reservations.
 *
 * Supabase does not allow arbitrary SQL through @supabase/supabase-js, so the
 * DDL needs one of these in the root .env:
 *
 *   SUPABASE_DB_URL      Postgres connection string (Dashboard > Connect)
 *   SUPABASE_ACCESS_TOKEN  Personal access token (Dashboard > Account > Access Tokens)
 *
 * With neither set, we fall back to checking whether the tables already exist
 * and print setup instructions instead of failing the server.
 */

dotenv.config({ quiet: true })

const schemaUrl = new URL('./schema.sql', import.meta.url)

function projectRef() {
    try {
        return new URL(process.env.SUPABASE_URL).hostname.split('.')[0] || null
    } catch {
        return null
    }
}

async function runSql(connectionString, accessToken, sql) {
    if (connectionString) {
        const { default: pg } = await import('pg')
        const isLocal = /(^|@)(localhost|127\.0\.0\.1)(:|\/)/.test(connectionString)
        const client = new pg.Client({
            connectionString,
            ssl: isLocal ? false : { rejectUnauthorized: false },
        })

        await client.connect()
        try {
            await client.query(sql)
        } finally {
            await client.end()
        }
        return
    }

    const ref = projectRef()
    if (!ref) {
        throw new Error('Could not read the project ref from SUPABASE_URL.')
    }

    const response = await fetch(
        `https://api.supabase.com/v1/projects/${ref}/database/query`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: sql }),
        }
    )

    if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(
            `Supabase Management API returned ${response.status}: ${body.slice(0, 300)}`
        )
    }
}

async function missingTables() {
    const missing = []

    for (const table of ['users', 'shirts']) {
        // A real GET, not `head: true`: PostgREST answers HEAD on a missing
        // table with 204 and no error, which would look like success.
        const { error } = await supabase.from(table).select('id').limit(1)

        if (!error) continue

        // PGRST205: table missing from PostgREST cache, 42P01: undefined_table.
        if (error.code === 'PGRST205' || error.code === '42P01') {
            missing.push(table)
            continue
        }

        throw new Error(error.message)
    }

    return missing
}

export async function ensureSchema() {
    const connectionString =
        process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
    const accessToken = process.env.SUPABASE_ACCESS_TOKEN

    if (!connectionString && !accessToken) {
        let missing
        try {
            missing = await missingTables()
        } catch (error) {
            console.warn(`[db] Could not verify the schema: ${error.message}`)
            return { ok: false }
        }

        if (missing.length === 0) {
            console.log('[db] Schema already present — nothing to create.')
            return { ok: true }
        }

        console.warn(
            [
                '',
                `[db] Missing table(s): public.${missing.join(', public.')}`,
                '[db] Add ONE of the following to .env so `npm run dev` creates them:',
                '[db]   SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres',
                '[db]   SUPABASE_ACCESS_TOKEN=sbp_...',
                '[db] Or run backend/sql/schema.sql once in the Supabase SQL Editor.',
                '',
            ].join('\n')
        )
        return { ok: false }
    }

    try {
        const sql = await readFile(schemaUrl, 'utf8')
        await runSql(connectionString, accessToken, sql)
        console.log('[db] Schema ensured (users + shirts).')
        return { ok: true }
    } catch (error) {
        console.error(`[db] Automatic schema setup failed: ${error.message}`)
        return { ok: false }
    }
}

/* Allow `node backend/sql/ensureSchema.js` (npm run db:setup). */
const isDirectRun =
    process.argv[1] &&
    pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectRun) {
    const result = await ensureSchema()
    process.exit(result.ok ? 0 : 1)
}
