import express from "express";
import {
    getReportSummary,
    getSalesOverview,
    getTopSellingProducts,
    getCategoryPerformance,
    getRecentTransactions,
    exportReport
} from "../controllers/reportControllers.js";
import { authMiddleware } from "../middleware/authmiddleware.js";

const router = express.Router();

router.get("/summary", authMiddleware, getReportSummary)
router.get("/sales-overview", authMiddleware, getSalesOverview);
router.get("/top-selling-products", authMiddleware, getTopSellingProducts);
router.get("/category-performance", authMiddleware, getCategoryPerformance);
router.get("/recent-transactions", authMiddleware, getRecentTransactions);
router.get('/export', authMiddleware, exportReport);


export default router;