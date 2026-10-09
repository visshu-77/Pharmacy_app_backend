import mongoose from "mongoose";

import creditCustomerModel from "../model/creditCustomer.js";
import creditTransactionModel from "../model/creditTransaction.js";
import {
    CUSTOMER_FILTERS,
    CUSTOMER_SORTS,
    CUSTOMER_STATUSES,
    getCustomerTotals,
    listCustomersWithBalances
} from "../services/creditService.js";

/**
 * Udhar khata — credit customers.
 *
 * Every query is scoped with `userId: req.user.id`, which comes from the
 * signed token and never from the request body, so one shop can neither read
 * nor change another shop's khata.
 */

const MAX_PAGE_SIZE = 100;

/** Trimmed string from a body field, or "" when it was not sent. */
const text = (value) => String(value ?? "").trim();

/** Mongoose validation → the first readable message, like the other screens. */
const firstValidationMessage = (error) =>
    Object.values(error.errors || {})[0]?.message || "Please check the details and try again";

/** Fields the owner may set, from the body only — never userId. */
const readCustomerInput = (body) => ({
    customerName: text(body.customerName),
    phone: text(body.phone),
    address: text(body.address),
    note: text(body.note)
});

const validateCustomerInput = ({ customerName, phone }) => {
    if (!customerName) return "Customer name is required";
    if (customerName.length > 80) return "Customer name is too long";
    if (phone && !/^\d{10}$/.test(phone)) return "Mobile number should be 10 digits, or leave it blank";

    return "";
};

/**
 * Is this phone / name already in this shop's khata?
 * `exceptId` lets an edit keep its own record.
 */
const findDuplicate = async (userId, { customerName, phone }, exceptId = null) => {
    const base = exceptId ? { userId, _id: { $ne: exceptId } } : { userId };

    if (phone) {
        const samePhone = await creditCustomerModel.findOne({ ...base, phone });

        if (samePhone) {
            return {
                customer: samePhone,
                message: `${samePhone.customerName} is already saved with this mobile number`
            };
        }

        return null;
    }

    // Without a phone there is nothing to tell two people apart by, so an
    // exact name match is treated as the same person.
    const sameName = await creditCustomerModel.findOne({
        ...base,
        phone: "",
        customerName: new RegExp(`^${customerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
    });

    if (sameName) {
        return {
            customer: sameName,
            message: "You already have a customer with this name. Add their mobile number to tell them apart."
        };
    }

    return null;
};

// ---------------------------------------------------------------------------
// POST /udhar/customer/create
// ---------------------------------------------------------------------------
export const createCustomer = async (req, res) => {
    try {
        const input = readCustomerInput(req.body);
        const message = validateCustomerInput(input);

        if (message) {
            return res.status(400).json({ message });
        }

        const duplicate = await findDuplicate(req.user.id, input);

        if (duplicate) {
            return res.status(409).json({
                message: duplicate.message,
                customerId: duplicate.customer._id
            });
        }

        const customer = await creditCustomerModel.create({
            ...input,
            userId: req.user.id
        });

        return res.status(201).json({
            message: "Customer added to your khata",
            customer: { ...customer.toObject(), outstanding: 0, charged: 0, paid: 0, entryCount: 0 }
        });

    } catch (error) {
        // The unique index caught a duplicate the lookup above raced past.
        if (error.code === 11000) {
            return res.status(409).json({
                message: "This mobile number is already saved in your khata"
            });
        }

        if (error.name === "ValidationError") {
            return res.status(400).json({ message: firstValidationMessage(error) });
        }

        console.log("Create credit customer error:", error);

        return res.status(500).json({ message: "Server error" });
    }
};

// ---------------------------------------------------------------------------
// GET /udhar/customer/all
//   ?search= &filter=all|due|clear &status=all|active|inactive
//   &sort=outstanding|name|recent &page=1 &limit=20
// ---------------------------------------------------------------------------
export const getCustomers = async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);

        const limit = Math.min(
            MAX_PAGE_SIZE,
            Math.max(1, Number.parseInt(req.query.limit, 10) || 20)
        );

        const filter = CUSTOMER_FILTERS.includes(req.query.filter) ? req.query.filter : "all";
        const sort = CUSTOMER_SORTS.includes(req.query.sort) ? req.query.sort : "outstanding";
        const status = CUSTOMER_STATUSES.includes(req.query.status) ? req.query.status : "all";

        const { customers, total, pages, totals } = await listCustomersWithBalances({
            userId: req.user.id,
            search: text(req.query.search),
            filter,
            sort,
            status,
            page,
            limit
        });

        return res.status(200).json({
            message: "Customers fetched successfully",
            customers,
            pagination: { page, limit, total, pages },
            totals
        });

    } catch (error) {
        console.log("Get credit customers error:", error);

        return res.status(500).json({ message: "Server error" });
    }
};

// ---------------------------------------------------------------------------
// GET /udhar/customer/single/:id — profile, balance and recent entries
// ---------------------------------------------------------------------------
export const getCustomerById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid customer id" });
        }

        const customer = await creditCustomerModel
            .findOne({ _id: id, userId: req.user.id })
            .lean();

        // Someone else's customer is simply "not found" — the reply must not
        // reveal that the id exists in another shop.
        if (!customer) {
            return res.status(404).json({ message: "Customer not found" });
        }

        const [totals, recentTransactions] = await Promise.all([
            getCustomerTotals(req.user.id, id),
            creditTransactionModel
                .find({ userId: req.user.id, customerId: id })
                .sort({ date: -1, createdAt: -1 })
                .limit(10)
                .lean()
        ]);

        return res.status(200).json({
            message: "Customer fetched successfully",
            customer: { ...customer, ...totals },
            recentTransactions
        });

    } catch (error) {
        console.log("Get credit customer error:", error);

        return res.status(500).json({ message: "Server error" });
    }
};

// ---------------------------------------------------------------------------
// PUT /udhar/customer/update/:id
// ---------------------------------------------------------------------------
export const updateCustomer = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid customer id" });
        }

        const existing = await creditCustomerModel.findOne({ _id: id, userId: req.user.id });

        if (!existing) {
            return res.status(404).json({ message: "Customer not found" });
        }

        // Only the fields that were actually sent change; the rest stay.
        const input = {
            customerName: req.body.customerName === undefined ? existing.customerName : text(req.body.customerName),
            phone: req.body.phone === undefined ? existing.phone : text(req.body.phone),
            address: req.body.address === undefined ? existing.address : text(req.body.address),
            note: req.body.note === undefined ? existing.note : text(req.body.note)
        };

        const message = validateCustomerInput(input);

        if (message) {
            return res.status(400).json({ message });
        }

        if (req.body.isActive !== undefined) {
            if (typeof req.body.isActive !== "boolean") {
                return res.status(400).json({ message: "isActive must be true or false" });
            }

            input.isActive = req.body.isActive;
        }

        const duplicate = await findDuplicate(req.user.id, input, existing._id);

        if (duplicate) {
            return res.status(409).json({
                message: duplicate.message,
                customerId: duplicate.customer._id
            });
        }

        existing.set(input);

        await existing.save();

        const totals = await getCustomerTotals(req.user.id, existing._id);

        return res.status(200).json({
            message: "Customer updated successfully",
            customer: { ...existing.toObject(), ...totals }
        });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                message: "This mobile number is already saved in your khata"
            });
        }

        if (error.name === "ValidationError") {
            return res.status(400).json({ message: firstValidationMessage(error) });
        }

        console.log("Update credit customer error:", error);

        return res.status(500).json({ message: "Server error" });
    }
};
