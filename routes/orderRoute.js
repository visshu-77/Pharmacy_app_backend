import express from "express";
import { createOrder } from "../controllers/orderControllers.js";
import { authMiddleware } from "../middleware/authmiddleware.js";

const router = express.Router();

router.post("/create-order", authMiddleware, createOrder);

export default router;