import express from "express";

import {
    createSupplier,
    getSuppliers,
    getSupplierById,
    updateSupplier,
    deleteSupplier
} from "../controllers/supplierController.js";

import { authMiddleware } from "../middleware/authmiddleware.js";

const router = express.Router();

router.post(
    "/create",
    authMiddleware,
    createSupplier
);
router.get('/all-supplier', authMiddleware, getSuppliers);
router.get('/single/:id', authMiddleware, getSupplierById);
router.put('/update/:id', authMiddleware, updateSupplier);
router.delete('/delete/:id', authMiddleware, deleteSupplier);

export default router;