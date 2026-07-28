import express from 'express';
import { addProduct, getProduct } from '../controllers/productControllers.js';
import { authMiddleware } from '../middleware/authmiddleware.js';

const router = express();

router.post('/add',authMiddleware, addProduct);
router.get('/get',authMiddleware, getProduct);

export default router;