import express from "express";

import {
    createSupplier,
    getSuppliers,
    getSupplierById,
    updateSupplier,
    deleteSupplier,
    importSuppliers,
    deleteSelectedSuppliers,
    deleteAllSuppliers,
    searchSuppliers
} from "../controllers/supplierController.js";

import { authMiddleware } from "../middleware/authmiddleware.js";

const router = express.Router();

router.post(
    "/create",
    authMiddleware,
    createSupplier
);
router.get('/all-supplier', authMiddleware, getSuppliers);
router.get('/search', authMiddleware, searchSuppliers);
router.get('/single/:id', authMiddleware, getSupplierById);
router.put('/update/:id', authMiddleware, updateSupplier);
router.delete('/delete/:id', authMiddleware, deleteSupplier);
router.post('/import', authMiddleware, importSuppliers);
router.delete('/delete-selected', authMiddleware, deleteSelectedSuppliers);
router.delete('/delete-all', authMiddleware, deleteAllSuppliers);

export default router;