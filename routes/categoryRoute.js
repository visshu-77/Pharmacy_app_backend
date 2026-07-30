import express from 'express';
import { addCategory, deleteCategory, getCategory, updatecategory } from "../controllers/categoryControllers.js";
import { authMiddleware } from '../middleware/authmiddleware.js';

const router = express();

router.post('/add' ,authMiddleware, addCategory);
router.get('/get', authMiddleware, getCategory);
router.delete('/delete/:id', authMiddleware, deleteCategory);
router.put('/update/:id',authMiddleware, updatecategory);

export default router;
