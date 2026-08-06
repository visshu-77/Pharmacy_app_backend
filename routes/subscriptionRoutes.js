import express from "express"

import { createPaymentOrder, createSubscription, verifyPayment, getMySubscription } from "../controllers/subscriptionController.js";
import { authMiddleware } from '../middleware/authmiddleware.js';
import { checkSubscription } from "../middleware/subscriptionMiddleware.js";

const router = express();

router.post("/create", authMiddleware, checkSubscription, createSubscription);
router.post("/create-payment", authMiddleware, createPaymentOrder);
router.post("/verify-payment", authMiddleware, verifyPayment);
router.get("/my-subscription", authMiddleware, getMySubscription);

export default router;