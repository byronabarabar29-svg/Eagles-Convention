import express from 'express'

import {
    deleteShirt,
    getShirts,
    registerShirt,
    updateShirt,
} from '../controllers/shirtControllers.js'

export const shirtRoutes = express.Router()

shirtRoutes.post('/', registerShirt)
shirtRoutes.get('/', getShirts)
shirtRoutes.patch('/:id', updateShirt)
shirtRoutes.delete('/:id', deleteShirt)
