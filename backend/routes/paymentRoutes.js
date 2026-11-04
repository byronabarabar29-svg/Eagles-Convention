import express from 'express'

import {
    getPaymentByReference,
    submitPayment,
} from '../controllers/paymentControllers.js'

export const paymentRoutes = express.Router()

paymentRoutes.post('/', submitPayment)
paymentRoutes.get('/', getPaymentByReference)
