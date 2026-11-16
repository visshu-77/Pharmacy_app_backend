import express from "express";
import { createOrder, getOrderHistory } from "../controllers/orderControllers.js";
import { authMiddleware } from "../middleware/authmiddleware.js";

const router = express.Router();

router.get("/history", authMiddleware, getOrderHistory);
router.post("/create-order", authMiddleware, createOrder);

export default router;