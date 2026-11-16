import express from "express";
import {
    createExpenseTransaction,
    deleteExpenseTransaction,
    exportExpenseReport,
    getExpenseDashboard,
    getExpenseReceipt,
    getExpenseReport,
    getExpenseTransaction,
    getExpenseTransactions,
    updateExpenseTransaction
} from "../controllers/expenseController.js";
import {
    createExpenseCategory,
    deleteExpenseCategory,
    getExpenseCategories,
    updateExpenseCategory
} from "../controllers/expenseCategoryController.js";
import {
    createRecurringExpense,
    deleteRecurringExpense,
    getRecurringExpenses,
    updateRecurringExpense
} from "../controllers/recurringExpenseController.js";
import { authMiddleware } from "../middleware/authmiddleware.js";
import { checkSubscription } from "../middleware/subscriptionMiddleware.js";
import receiptUpload, { handleExpenseReceiptUpload } from "../middleware/expenseReceiptUpload.js";

const router = express.Router();
router.use(authMiddleware, checkSubscription);

router.get("/dashboard", getExpenseDashboard);
router.get("/reports", getExpenseReport);
router.get("/reports/export", exportExpenseReport);

router.get("/transactions", getExpenseTransactions);
router.post("/transactions", handleExpenseReceiptUpload(receiptUpload.single("receipt")), createExpenseTransaction);
router.get("/transactions/:id/receipt", getExpenseReceipt);
router.get("/transactions/:id", getExpenseTransaction);
router.patch("/transactions/:id", handleExpenseReceiptUpload(receiptUpload.single("receipt")), updateExpenseTransaction);
router.delete("/transactions/:id", deleteExpenseTransaction);

router.get("/categories", getExpenseCategories);
router.post("/categories", createExpenseCategory);
router.patch("/categories/:id", updateExpenseCategory);
router.delete("/categories/:id", deleteExpenseCategory);

router.get("/recurring", getRecurringExpenses);
router.post("/recurring", createRecurringExpense);
router.patch("/recurring/:id", updateRecurringExpense);
router.delete("/recurring/:id", deleteRecurringExpense);

export default router;
