import express from 'express';
import { addProduct, deleteProduct, exportproducts, getProduct, updateCategory, importProducts } from '../controllers/productControllers.js';
import { authMiddleware } from '../middleware/authmiddleware.js';
import multer from "multer";
const upload = multer({ storage: multer.memoryStorage() });

const router = express();

router.post('/add',authMiddleware, addProduct);
router.get('/get',authMiddleware, getProduct);
router.delete("/delete/:id",authMiddleware, deleteProduct);
router.put('/update/:id', authMiddleware, updateCategory);

router.get("/exports",authMiddleware, exportproducts);
router.post("/imports",authMiddleware, upload.single("file"), importProducts)

export default router;