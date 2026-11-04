import express from 'express'

import {
    getUserByReference,
    loginUser,
    registerUser,
} from '../controllers/userControllers.js'

export const userRoutes = express.Router()

userRoutes.post('/register', registerUser)
userRoutes.post('/login', loginUser)
userRoutes.get('/:reference', getUserByReference)
