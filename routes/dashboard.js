import express from "express";

import { getDashboardSummary } from "../controllers/dashboardController.js";
import { authMiddleware } from "../middleware/authmiddleware.js";

const router = express.Router();

router.get(
    "/summary", authMiddleware,
    getDashboardSummary
);

export default router;