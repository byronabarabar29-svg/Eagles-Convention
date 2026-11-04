import 'dotenv/config'

import express from 'express'
import cors from 'cors'

import { shirtRoutes } from './routes/shirtRoutes.js'
import { userRoutes } from './routes/userRoutes.js'
import { ensureSchema } from './sql/ensureSchema.js'

const app = express()
const port = Number(process.env.PORT) || 3000

app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

/* ── Health check ─────────────────────────────────────────── */
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: '3rd Mindanao Convention API',
        time: new Date().toISOString(),
    })
})

/* ── API routes ───────────────────────────────────────────── */
app.use('/api/users', userRoutes)
app.use('/api/shirts', shirtRoutes)

/* ── 404 handler ──────────────────────────────────────────── */
app.use((req, res) => {
    res.status(404).json({
        message: `Route not found: ${req.method} ${req.originalUrl}`,
    })
})

/* ── Error handler ────────────────────────────────────────── */
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err)
    res.status(err.status || 500).json({
        message: err.message || 'Internal server error.',
    })
})

/* ── Database schema ──────────────────────────────────────── */
/* Create missing tables before accepting requests (safe to re-run). */
const db = await ensureSchema()

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`)
    if (!db.ok) {
        console.warn(
            'Server started, but the database may be incomplete. See the [db] messages above.'
        )
    }
})
