import express from "express";

import {
    getAllCustomers,
    getCustomerById,
    updateCustomer,
    toggleCustomerStatus,
    deleteCustomer,
    getCustomerSubscriptions,
    getAdminDashboard
} from "../controllers/adminController.js";

import { authMiddleware } from "../middleware/authmiddleware.js";
import { adminMiddleware } from "../middleware/adminMiddleware.js";


const router = express.Router();


// Get all customers
router.get(
    "/customers",
    authMiddleware,
    adminMiddleware,
    getAllCustomers
);


// Get single customer
router.get(
    "/customers/:id",
    authMiddleware,
    adminMiddleware,
    getCustomerById
);


// Update customer
router.put(
    "/customers/:id",
    authMiddleware,
    adminMiddleware,
    updateCustomer
);


// Activate / deactivate customer
router.patch(
    "/customers/:id/status",
    authMiddleware,
    adminMiddleware,
    toggleCustomerStatus
);


// Delete customer
router.delete(
    "/customers/:id",
    authMiddleware,
    adminMiddleware,
    deleteCustomer
);


// Get customer's subscriptions
router.get(
    "/customers/:id/subscriptions",
    authMiddleware,
    adminMiddleware,
    getCustomerSubscriptions
);

router.get(
    "/dashboard",
    authMiddleware,
    adminMiddleware,
    getAdminDashboard
);


export default router;
