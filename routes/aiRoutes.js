import express from "express";
import { askCustomerQuery } from "../controllers/aiController.js";
import { authMiddleware } from "../middleware/authmiddleware.js"

const router = express();

router.post("/customer-query", authMiddleware, askCustomerQuery);

export default router;