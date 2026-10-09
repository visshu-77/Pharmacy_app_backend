import express from "express";

import {
    createCustomer,
    getCustomers,
    getCustomerById,
    updateCustomer
} from "../controllers/creditController.js";

import {
    recordCreditSale,
    recordPayment,
    getTransactions,
    reverseTransaction,
    updateTransaction,
    getSummary,
    exportStatement,
    getReminder
} from "../controllers/creditLedgerController.js";

import { authMiddleware } from "../middleware/authmiddleware.js";
import { checkSubscription } from "../middleware/subscriptionMiddleware.js";

const router = express.Router();

// Guarded like /product and /note: signed in, and on a live plan.
router.post("/customer/create", authMiddleware, checkSubscription, createCustomer);
router.get("/customer/all", authMiddleware, checkSubscription, getCustomers);
router.get("/customer/single/:id", authMiddleware, checkSubscription, getCustomerById);
router.put("/customer/update/:id", authMiddleware, checkSubscription, updateCustomer);

// Ledger: goods given on credit, money repaid, and traceable corrections.
router.post("/credit", authMiddleware, checkSubscription, recordCreditSale);
router.post("/payment", authMiddleware, checkSubscription, recordPayment);
router.get("/transactions", authMiddleware, checkSubscription, getTransactions);
router.post("/transaction/:id/reverse", authMiddleware, checkSubscription, reverseTransaction);
router.patch("/transaction/:id", authMiddleware, checkSubscription, updateTransaction);
router.get("/summary", authMiddleware, checkSubscription, getSummary);
router.get("/statement/export", authMiddleware, checkSubscription, exportStatement);
router.get("/customer/:id/reminder", authMiddleware, checkSubscription, getReminder);

export default router;
