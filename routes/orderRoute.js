import express from "express";
import { createOrder, deleteOrder, getOrderHistory } from "../controllers/orderControllers.js";
import { authMiddleware } from "../middleware/authmiddleware.js";

const router = express.Router();

router.get("/history", authMiddleware, getOrderHistory);
router.delete("/:id", authMiddleware, deleteOrder);
router.post("/create-order", authMiddleware, createOrder);

export default router;