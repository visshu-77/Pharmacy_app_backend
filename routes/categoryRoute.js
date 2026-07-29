import express from 'express';
import { addCategory, getCategory } from "../controllers/categoryControllers.js";
import { authMiddleware } from '../middleware/authmiddleware.js';

const router = express();

router.post('/add' ,authMiddleware, addCategory);
router.get('/get', authMiddleware, getCategory);

export default router;
