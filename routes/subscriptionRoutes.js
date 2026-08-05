import express from "express"

import { createPaymentOrder, createSubscription, verifyPayment } from "../controllers/subscriptionController.js";
import { authMiddleware } from '../middleware/authmiddleware.js';

const router = express();

router.post("/create", authMiddleware, createSubscription);
router.post("/create-payment", authMiddleware, createPaymentOrder);
router.post("/verify-payment", authMiddleware, verifyPayment);

export default router;