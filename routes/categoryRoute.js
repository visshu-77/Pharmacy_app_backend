import express from 'express';
import {
    addCategory,
    deleteCategory,
    getCategory,
    updatecategory,
    viewCategory,
    deleteSelectedCategories,
    deleteAllCategories
} from "../controllers/categoryControllers.js";
import { authMiddleware } from '../middleware/authmiddleware.js';
import { checkSubscription } from '../middleware/subscriptionMiddleware.js';

const router = express();

router.post('/add', authMiddleware, checkSubscription, addCategory);
router.get('/get', authMiddleware, checkSubscription, getCategory);
router.delete('/delete/:id', authMiddleware, checkSubscription, deleteCategory);
router.put('/update/:id', authMiddleware, checkSubscription, updatecategory);
router.get('/single/:id', authMiddleware, checkSubscription, viewCategory)

router.delete('/delete-selected', authMiddleware, deleteSelectedCategories);
router.delete('/delete-all', authMiddleware, deleteAllCategories);

export default router;
