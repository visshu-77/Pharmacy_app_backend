import express from "express";

import { createCashReceipt, getCashReceiptHistory } from "../controllers/cashReceiptController.js";
import { authMiddleware } from "../middleware/authmiddleware.js";

const router = express.Router();

router.get("/", authMiddleware, getCashReceiptHistory);
router.post("/", authMiddleware, createCashReceipt);

export default router;
