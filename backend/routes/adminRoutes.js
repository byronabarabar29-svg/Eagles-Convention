import express from 'express'

import {
    getAdminSession,
    getAdminUser,
    listAdminUsers,
    verifyPayment,
} from '../controllers/adminControllers.js'
import { requireAdmin } from '../utils/adminAuth.js'

export const adminRoutes = express.Router()

adminRoutes.use(requireAdmin)

adminRoutes.get('/session', getAdminSession)
adminRoutes.get('/users', listAdminUsers)
adminRoutes.get('/users/:reference', getAdminUser)
adminRoutes.patch('/payments/:id/verify', verifyPayment)
