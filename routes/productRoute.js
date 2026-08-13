import express from 'express';
import {
    addProduct,
    deleteProduct,
    exportproducts,
    getProduct,
    updateCategory,
    importProducts,
    singleProduct,
    searchProducts,
    deleteSelectedProducts,
    deleteAllProducts
} from '../controllers/productControllers.js';
import { authMiddleware } from '../middleware/authmiddleware.js';
import { checkSubscription } from "../middleware/subscriptionMiddleware.js";
import multer from "multer";
const upload = multer({ storage: multer.memoryStorage() });

const router = express();

router.post('/add', authMiddleware, checkSubscription, addProduct);
router.get('/get', authMiddleware, checkSubscription, getProduct);
router.get("/search", authMiddleware, checkSubscription, searchProducts);
router.delete("/delete/:id", authMiddleware, checkSubscription, deleteProduct);
router.put('/update/:id', authMiddleware, checkSubscription, updateCategory);

router.get("/exports", authMiddleware, checkSubscription, exportproducts);
router.post("/imports", authMiddleware, checkSubscription, upload.single("file"), importProducts);

router.get('/single/:id', authMiddleware, checkSubscription, singleProduct)

router.delete('/delete-selected', authMiddleware, deleteSelectedProducts);
router.delete('/delete-all', authMiddleware, deleteAllProducts);

export default router;