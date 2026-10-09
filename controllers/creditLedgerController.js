import mongoose from "mongoose";

import creditCustomerModel from "../model/creditCustomer.js";
import creditTransactionModel, {
    CREDIT_PAYMENT_METHODS,
    CREDIT_TRANSACTION_TYPES
} from "../model/creditTransaction.js";
import orderModel from "../model/order.js";
import userModel from "../model/users.js";

import { Parser } from "json2csv";

import { withTransaction } from "../services/dbSession.js";
import {
    getCustomerTotals,
    getRecentActivity,
    getShopSummary,
    getStatement,
    getStatementRows,
    MAX_EXPORT_ROWS,
    resolveDateRange,
    round2
} from "../services/creditService.js";
import {
    applySaleTotals,
    buildSaleItems,
    deductStockForItems,
    isSaleError,
    restoreStockForItems,
    STOCK_RACE_ERROR
} from "../services/saleService.js";

/**
 * Udhar khata — the ledger itself: goods given on credit, money repaid, and
 * traceable corrections.
 *
 * Two rules hold the whole thing together:
 *
 *   1. Stock moves in exactly one place, the shared sale service, and only
 *      for an itemised credit sale. A repayment never touches stock, and a
 *      custom-amount entry never does either.
 *   2. A repayment is never an order. Orders are sales; money coming back
 *      against an old sale is not a new sale, so it can never inflate
 *      takings in any existing report.
 */

const MAX_PAGE_SIZE = 200;
const MAX_AMOUNT = 10000000;

// Floating point slack when comparing rupee amounts.
const EPSILON = 0.001;

const text = (value) => String(value ?? "").trim();

const firstValidationMessage = (error) =>
    Object.values(error.errors || {})[0]?.message || "Please check the details and try again";

/** A positive rupee amount with no more than paise precision, or null. */
const parseAmount = (value) => {
    const amount = Number(value);

    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;
    if (Math.round(amount * 100) / 100 !== amount) return null;

    return amount;
};

/** Zero or more — a discount or a tax. `undefined` means "not sent". */
const parseOptionalAmount = (value) => {
    if (value === undefined || value === null || value === "") return 0;

    const amount = Number(value);

    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) return null;

    // Drift from adding prices up is smoothed over in the sale service, but a
    // figure typed in with more precision than money has is a mistake worth
    // saying out loud.
    if (Math.round(amount * 100) / 100 !== amount) return null;

    return amount;
};

const parseDate = (value) => {
    if (value === undefined || value === null || value === "") return new Date();

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
};

const creditInvoiceNumber = () =>
    `UDH-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

/** The customer, if they belong to this shop. */
const loadCustomer = async (userId, customerId) => {
    if (!mongoose.Types.ObjectId.isValid(customerId)) return "invalid";

    return creditCustomerModel.findOne({ _id: customerId, userId });
};

const outstandingFor = async (userId, customerId, session = null) =>
    (await getCustomerTotals(userId, customerId, session)).outstanding;

/**
 * The reply a repeated submission gets: the entry that was already saved.
 *
 * Returns false when this was not a repeat at all. A duplicate-key error can
 * come from any unique index — an invoice number, say — and answering "already
 * recorded" to one of those would report a failed write as a success.
 */
const alreadyRecorded = async (res, userId, idempotencyKey) => {
    if (!idempotencyKey) return false;

    const transaction = await creditTransactionModel.findOne({ userId, idempotencyKey });

    if (!transaction) return false;

    res.status(200).json({
        message: "Already recorded",
        duplicate: true,
        transaction
    });

    return true;
};

/** Maps the shared sale/stock/validation errors onto replies. */
const sendWriteError = (res, error, label) => {
    if (isSaleError(error)) {
        return res.status(error.status).json({ message: error.message });
    }

    if (error.message === STOCK_RACE_ERROR) {
        return res.status(409).json({
            message: "Stock changed while saving. Please check the quantities and try again."
        });
    }

    if (error.status && error.expected) {
        return res.status(error.status).json({ message: error.message, ...error.details });
    }

    if (error.name === "ValidationError") {
        return res.status(400).json({ message: firstValidationMessage(error) });
    }

    console.log(`${label}:`, error);

    return res.status(500).json({ message: "Server error" });
};

/** An error that is the caller's to fix, carrying extra context for them. */
const refuse = (status, message, details = {}) => {
    const error = new Error(message);

    error.status = status;
    error.expected = true;
    error.details = details;

    return error;
};

// ---------------------------------------------------------------------------
// POST /udhar/credit — goods or an amount given on credit
//
// Body: { customerId, items?: [{ productId, quantity, price? }], amount?,
//         discount?, tax?, date?, description?, referenceNumber?,
//         idempotencyKey? }
//
// With items it is a real sale: stock comes off and an order is written.
// Without them it is a plain line in the khata and no stock moves.
// ---------------------------------------------------------------------------
export const recordCreditSale = async (req, res) => {
    try {
        const userId = req.user.id;
        const { customerId, items, description = "", referenceNumber = "", idempotencyKey } = req.body;

        const customer = await loadCustomer(userId, customerId);

        if (customer === "invalid") {
            return res.status(400).json({ message: "Invalid customer id" });
        }

        if (!customer) {
            return res.status(404).json({ message: "Customer not found" });
        }

        const date = parseDate(req.body.date);

        if (!date) {
            return res.status(400).json({ message: "Invalid date" });
        }

        const key = text(idempotencyKey) || undefined;

        if (key && (await alreadyRecorded(res, userId, key))) {
            return undefined;
        }

        const balanceBefore = await outstandingFor(userId, customer._id);

        const shared = {
            userId,
            customerId: customer._id,
            createdBy: userId,
            type: "CREDIT_SALE",
            date,
            description: text(description).slice(0, 250),
            referenceNumber: text(referenceNumber).slice(0, 40),
            ...(key ? { idempotencyKey: key } : {})
        };

        // ---------------------------------------------------- custom amount
        if (!Array.isArray(items) || items.length === 0) {
            const amount = parseAmount(req.body.amount);

            if (!amount) {
                return res.status(400).json({
                    message: "Enter an amount in rupees, or add the items that were taken"
                });
            }

            const transaction = await creditTransactionModel.create({
                ...shared,
                entryMode: "custom",
                amount
            });

            return res.status(201).json({
                message: "Added to the khata",
                transaction,
                balanceBefore,
                balanceAfter: round2(balanceBefore + amount)
            });
        }

        // ------------------------------------------------------ itemised sale
        const discount = parseOptionalAmount(req.body.discount);
        const tax = parseOptionalAmount(req.body.tax);

        if (discount === null || tax === null) {
            return res.status(400).json({
                message: "Discount and tax must be 0 or more, in rupees and paise"
            });
        }

        /**
         * The whole sale. `track` records what has already happened so the
         * no-transaction path can undo exactly that much.
         */
        const perform = async (session, track = {}) => {
            const { orderItems, subtotal } = await buildSaleItems({
                userId,
                items,
                session,
                // The owner may name a price for this sale, as on Sales Note.
                allowPriceOverride: true
            });

            const totals = applySaleTotals({ subtotal, discount, tax });

            try {
                track.applied = await deductStockForItems({
                    userId,
                    items: orderItems,
                    session
                });
            } catch (error) {
                track.applied = error.applied || [];
                throw error;
            }

            const [order] = await orderModel.create(
                [{
                    invoiceNumber: creditInvoiceNumber(),
                    userId,
                    customerName: customer.customerName,
                    customerPhone: customer.phone || "",
                    creditCustomerId: customer._id,
                    items: orderItems,
                    subtotal,
                    discount: totals.discount,
                    tax: totals.tax,
                    grandTotal: totals.grandTotal,
                    paymentMethod: "Credit",
                    // Never flipped to Paid: repayment is tracked against the
                    // customer, not against one bill. This is also what keeps
                    // udhar out of every "paymentStatus: Paid" report.
                    paymentStatus: "Pending",
                    source: "credit",
                    remark: shared.description
                }],
                session ? { session } : {}
            );

            track.order = order;

            const [transaction] = await creditTransactionModel.create(
                [{
                    ...shared,
                    entryMode: "product",
                    amount: totals.grandTotal,
                    discount: totals.discount,
                    tax: totals.tax,
                    orderId: order._id,
                    items: orderItems.map((item) => ({
                        productId: item.productId,
                        productName: item.productName,
                        price: item.price,
                        quantity: item.quantity,
                        unit: item.unit,
                        total: item.total
                    }))
                }],
                session ? { session } : {}
            );

            return { order, transaction };
        };

        const { order, transaction } = await withTransaction(
            (session) => perform(session),
            {
                // No transactions here (a standalone mongod). Do the same
                // writes and undo them by hand if one fails, so stock is
                // never left short of goods that were not sold.
                fallback: async () => {
                    const track = {};

                    try {
                        return await perform(null, track);

                    } catch (error) {
                        if (track.order) {
                            await orderModel.deleteOne({ _id: track.order._id, userId });
                        }

                        if (track.applied?.length) {
                            await restoreStockForItems({ userId, items: track.applied });
                        }

                        throw error;
                    }
                }
            }
        );

        return res.status(201).json({
            message: "Credit sale recorded",
            transaction,
            order,
            balanceBefore,
            balanceAfter: round2(balanceBefore + transaction.amount)
        });

    } catch (error) {
        if (error.code === 11000 && await alreadyRecorded(res, req.user.id, text(req.body.idempotencyKey))) {
            return undefined;
        }

        return sendWriteError(res, error, "Record credit sale error");
    }
};

// ---------------------------------------------------------------------------
// POST /udhar/payment — money received against the khata
//
// Body: { customerId, amount, paymentMethod, date?, referenceNumber?,
//         description?, idempotencyKey?, settleFull? }
// ---------------------------------------------------------------------------
export const recordPayment = async (req, res) => {
    try {
        const userId = req.user.id;
        const { customerId, paymentMethod, description = "", referenceNumber = "", idempotencyKey } = req.body;

        const customer = await loadCustomer(userId, customerId);

        if (customer === "invalid") {
            return res.status(400).json({ message: "Invalid customer id" });
        }

        if (!customer) {
            return res.status(404).json({ message: "Customer not found" });
        }

        if (!CREDIT_PAYMENT_METHODS.includes(paymentMethod)) {
            return res.status(400).json({
                message: `Choose how it was paid: ${CREDIT_PAYMENT_METHODS.join(", ")}`
            });
        }

        const date = parseDate(req.body.date);

        if (!date) {
            return res.status(400).json({ message: "Invalid date" });
        }

        const key = text(idempotencyKey) || undefined;

        if (key && (await alreadyRecorded(res, userId, key))) {
            return undefined;
        }

        const owed = await outstandingFor(userId, customer._id);

        // "Settle the whole khata" needs no amount typed in.
        const amount = req.body.settleFull === true ? round2(owed) : parseAmount(req.body.amount);

        if (!amount) {
            return res.status(400).json({
                message: owed > 0
                    ? "Enter how much was paid"
                    : "This customer has nothing outstanding"
            });
        }

        if (amount > owed + EPSILON) {
            return res.status(400).json({
                message: owed > 0
                    ? `That is more than the ₹${owed} outstanding`
                    : "This customer has nothing outstanding",
                outstanding: owed
            });
        }

        // A double-tapped button with no key to recognise it by: the same
        // amount, for the same customer, seconds ago is almost certainly the
        // same payment being saved twice.
        if (!key) {
            const justNow = await creditTransactionModel.findOne({
                userId,
                customerId: customer._id,
                type: "PAYMENT",
                amount,
                createdAt: { $gte: new Date(Date.now() - 10000) }
            });

            if (justNow) {
                return res.status(409).json({
                    message: "This payment was just recorded. Refresh the khata to see it.",
                    duplicateSuspected: true,
                    transaction: justNow
                });
            }
        }

        const row = {
            userId,
            customerId: customer._id,
            createdBy: userId,
            type: "PAYMENT",
            amount,
            paymentMethod,
            date,
            description: text(description).slice(0, 250),
            referenceNumber: text(referenceNumber).slice(0, 40),
            ...(key ? { idempotencyKey: key } : {})
        };

        const result = await withTransaction(
            async (session) => {
                // Touching the customer makes two payments arriving together
                // collide: MongoDB fails one with a write conflict and the
                // driver retries it against the new balance.
                await creditCustomerModel.updateOne(
                    { _id: customer._id, userId },
                    { $inc: { ledgerVersion: 1 } },
                    { session }
                );

                const before = await outstandingFor(userId, customer._id, session);

                if (amount > before + EPSILON) {
                    throw refuse(409, "The balance changed while saving. Please check and try again.", {
                        outstanding: before
                    });
                }

                const [transaction] = await creditTransactionModel.create([row], { session });

                return { transaction, balanceBefore: before, balanceAfter: round2(before - amount) };
            },
            {
                /**
                 * Without transactions, serialise by claiming the exact
                 * version of the customer we read the balance at. A writer
                 * that loses the claim starts over; one that wins still
                 * re-checks the balance afterwards and takes its own row back
                 * out if it turned out to overdraw.
                 */
                fallback: async () => {
                    for (let attempt = 0; attempt < 3; attempt += 1) {
                        const current = await creditCustomerModel
                            .findOne({ _id: customer._id, userId })
                            .select("ledgerVersion");

                        if (!current) {
                            throw refuse(404, "Customer not found");
                        }

                        const before = await outstandingFor(userId, customer._id);

                        if (amount > before + EPSILON) {
                            throw refuse(409, "The balance changed while saving. Please check and try again.", {
                                outstanding: before
                            });
                        }

                        const claim = await creditCustomerModel.updateOne(
                            { _id: customer._id, userId, ledgerVersion: current.ledgerVersion },
                            { $inc: { ledgerVersion: 1 } }
                        );

                        // Someone else wrote first; read again and redo.
                        if (claim.modifiedCount !== 1) continue;

                        const [transaction] = await creditTransactionModel.create([row]);

                        const after = await outstandingFor(userId, customer._id);

                        // A writer slipped in between the read and the claim.
                        // Take this row back out rather than leave the khata
                        // overpaid, and tell the caller to try again.
                        if (after < -EPSILON) {
                            await creditTransactionModel.deleteOne({ _id: transaction._id, userId });

                            throw refuse(409, "The balance changed while saving. Please check and try again.", {
                                outstanding: round2(after + amount)
                            });
                        }

                        return { transaction, balanceBefore: before, balanceAfter: after };
                    }

                    throw refuse(409, "The khata is busy. Please try again.");
                }
            }
        );

        return res.status(201).json({
            message: "Payment recorded",
            ...result,
            settled: result.balanceAfter <= EPSILON
        });

    } catch (error) {
        if (error.code === 11000 && await alreadyRecorded(res, req.user.id, text(req.body.idempotencyKey))) {
            return undefined;
        }

        return sendWriteError(res, error, "Record payment error");
    }
};

// ---------------------------------------------------------------------------
// GET /udhar/transactions — a customer's statement
//   ?customerId= &from= &to= &type= &order=asc|desc &page= &limit=
// ---------------------------------------------------------------------------
export const getTransactions = async (req, res) => {
    try {
        const userId = req.user.id;

        const customer = await loadCustomer(userId, req.query.customerId);

        if (customer === "invalid") {
            return res.status(400).json({ message: "Invalid customer id" });
        }

        if (!customer) {
            return res.status(404).json({ message: "Customer not found" });
        }

        const { from, to, error: rangeError } = resolveDateRange(req.query);

        if (rangeError) {
            return res.status(400).json({ message: rangeError });
        }

        const type = CREDIT_TRANSACTION_TYPES.includes(req.query.type) ? req.query.type : null;

        const paymentMethod = CREDIT_PAYMENT_METHODS.includes(req.query.paymentMethod)
            ? req.query.paymentMethod
            : null;

        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);

        const limit = Math.min(
            MAX_PAGE_SIZE,
            Math.max(1, Number.parseInt(req.query.limit, 10) || 50)
        );

        const statement = await getStatement({
            userId,
            customerId: customer._id,
            from,
            to,
            type,
            paymentMethod,
            page,
            limit,
            order: req.query.order === "desc" ? "desc" : "asc"
        });

        return res.status(200).json({
            message: "Statement fetched successfully",
            customer: {
                _id: customer._id,
                customerName: customer.customerName,
                phone: customer.phone,
                address: customer.address
            },
            ...statement
        });

    } catch (error) {
        console.log("Get statement error:", error);

        return res.status(500).json({ message: "Server error" });
    }
};

// ---------------------------------------------------------------------------
// POST /udhar/transaction/:id/reverse — cancel an entry, traceably
//
// Nothing is deleted. The original stays and is marked reversed, and an
// opposite adjustment is written against it, so the khata still explains
// itself. A reversed credit sale puts its goods back on the shelf, once.
// ---------------------------------------------------------------------------
export const reverseTransaction = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid transaction id" });
        }

        const reason = text(req.body.reason);

        if (reason.length < 3) {
            return res.status(400).json({ message: "Say why this entry is being cancelled" });
        }

        const original = await creditTransactionModel.findOne({ _id: id, userId });

        if (!original) {
            return res.status(404).json({ message: "Transaction not found" });
        }

        if (original.isReversed) {
            return res.status(409).json({ message: "This entry has already been cancelled" });
        }

        if (original.reversalOf) {
            return res.status(409).json({ message: "A cancellation cannot itself be cancelled" });
        }

        const date = parseDate(req.body.date);

        if (!date) {
            return res.status(400).json({ message: "Invalid date" });
        }

        const perform = async (session, track = {}) => {
            // Latch the original first: whoever flips this flag owns the
            // reversal, so the goods can go back exactly once.
            const latched = await creditTransactionModel.updateOne(
                { _id: original._id, userId, isReversed: false },
                { $set: { isReversed: true } },
                session ? { session } : {}
            );

            if (latched.modifiedCount !== 1) {
                throw refuse(409, "This entry has already been cancelled");
            }

            track.latched = true;

            const [reversal] = await creditTransactionModel.create(
                [{
                    userId,
                    customerId: original.customerId,
                    createdBy: userId,
                    type: "ADJUSTMENT",
                    direction: original.direction === "increase" ? "decrease" : "increase",
                    amount: original.amount,
                    date,
                    reason,
                    description: `Cancels ${original.type === "PAYMENT" ? "payment" : "entry"} of ₹${original.amount}`,
                    reversalOf: original._id
                }],
                session ? { session } : {}
            );

            track.reversal = reversal;

            // Goods sold on credit go back on the shelf — but only if this
            // call is the one that cancelled the bill.
            if (original.orderId) {
                const order = await orderModel.findOneAndUpdate(
                    { _id: original.orderId, userId, paymentStatus: { $ne: "Cancelled" } },
                    { $set: { paymentStatus: "Cancelled" } },
                    { new: true, ...(session ? { session } : {}) }
                );

                if (order) {
                    track.restored = order.items;

                    await restoreStockForItems({
                        userId,
                        items: order.items,
                        session
                    });
                }
            }

            return { reversal };
        };

        const { reversal } = await withTransaction(
            (session) => perform(session),
            {
                fallback: async () => {
                    const track = {};

                    try {
                        return await perform(null, track);

                    } catch (error) {
                        // Undo in reverse: the stock has not moved yet if we
                        // failed before it, and the latch must be released so
                        // the owner can try again.
                        if (track.reversal) {
                            await creditTransactionModel.deleteOne({ _id: track.reversal._id, userId });
                        }

                        if (track.latched) {
                            await creditTransactionModel.updateOne(
                                { _id: original._id, userId },
                                { $set: { isReversed: false } }
                            );
                        }

                        throw error;
                    }
                }
            }
        );

        const outstanding = await outstandingFor(userId, original.customerId);

        return res.status(201).json({
            message: "Entry cancelled",
            reversal,
            stockRestored: Boolean(original.orderId),
            outstanding
        });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: "This entry has already been cancelled" });
        }

        return sendWriteError(res, error, "Reverse transaction error");
    }
};

// ---------------------------------------------------------------------------
// PATCH /udhar/transaction/:id — only the words, never the money
//
// Amounts, types and dates are history. A wrong amount is fixed by
// cancelling the entry and writing the right one.
// ---------------------------------------------------------------------------
export const updateTransaction = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid transaction id" });
        }

        const changes = {};

        if (req.body.description !== undefined) {
            changes.description = text(req.body.description).slice(0, 250);
        }

        if (req.body.referenceNumber !== undefined) {
            changes.referenceNumber = text(req.body.referenceNumber).slice(0, 40);
        }

        if (Object.keys(changes).length === 0) {
            return res.status(400).json({
                message: "Only the description and reference can be edited. Cancel the entry to correct an amount."
            });
        }

        const transaction = await creditTransactionModel.findOneAndUpdate(
            { _id: id, userId: req.user.id },
            { $set: changes },
            { new: true, runValidators: true }
        );

        if (!transaction) {
            return res.status(404).json({ message: "Transaction not found" });
        }

        return res.status(200).json({
            message: "Entry updated",
            transaction
        });

    } catch (error) {
        if (error.name === "ValidationError") {
            return res.status(400).json({ message: firstValidationMessage(error) });
        }

        console.log("Update transaction error:", error);

        return res.status(500).json({ message: "Server error" });
    }
};

// ---------------------------------------------------------------------------
// GET /udhar/summary?from=&to= — what the shop is owed, and the period's flow
// ---------------------------------------------------------------------------
export const getSummary = async (req, res) => {
    try {
        const { from, to, error } = resolveDateRange(req.query);

        if (error) {
            return res.status(400).json({ message: error });
        }

        const userId = req.user.id;

        // One pass over the customers gives both the shop totals and the
        // handful at the top of the list.
        const [overview, recent] = await Promise.all([
            getShopSummary({ userId, from, to, topDebtors: 5 }),
            getRecentActivity({ userId, limit: 8, from, to })
        ]);

        return res.status(200).json({
            message: "Summary fetched successfully",
            summary: overview.summary,
            topDebtors: overview.topDebtors,
            recent,
            period: { from, to }
        });

    } catch (error) {
        console.log("Get udhar summary error:", error);

        return res.status(500).json({ message: "Server error" });
    }
};

// ---------------------------------------------------------------------------
// GET /udhar/statement/export?customerId=&from=&to= — the khata as a CSV
//
// Every figure comes from the saved ledger, not from anything the browser
// worked out, so a printed or exported statement can be relied on.
// ---------------------------------------------------------------------------
export const exportStatement = async (req, res) => {
    try {
        const userId = req.user.id;

        const customer = await loadCustomer(userId, req.query.customerId);

        if (customer === "invalid") {
            return res.status(400).json({ message: "Invalid customer id" });
        }

        // Another shop's id is simply not found — a guessed id reveals nothing.
        if (!customer) {
            return res.status(404).json({ message: "Customer not found" });
        }

        const { from, to, error } = resolveDateRange(req.query);

        if (error) {
            return res.status(400).json({ message: error });
        }

        const { openingBalance, rows, total, truncated, closingBalance } =
            await getStatementRows({
                userId,
                customerId: customer._id,
                from,
                to,
                limit: MAX_EXPORT_ROWS
            });

        if (rows.length === 0) {
            return res.status(404).json({ message: "No entries in this period" });
        }

        const asDate = (value) => new Date(value).toLocaleDateString("en-IN");

        const data = [
            {
                date: from ? asDate(from) : asDate(rows[0].date),
                type: "Opening balance",
                details: "",
                reference: "",
                paymentMethod: "",
                udhar: "",
                paid: "",
                balance: openingBalance
            },

            ...rows.map((row) => ({
                date: asDate(row.date),

                type: row.type === "CREDIT_SALE" ? "Udhar given"
                    : row.type === "PAYMENT" ? "Payment received"
                        : "Adjustment",

                details: row.description || row.reason || "",
                reference: row.referenceNumber || "",
                paymentMethod: row.paymentMethod || "",
                udhar: row.direction === "increase" ? row.amount : "",
                paid: row.direction === "decrease" ? row.amount : "",
                balance: row.runningBalance,
                cancelled: row.isReversed ? "yes" : ""
            }))
        ];

        const parser = new Parser({
            fields: [
                "date", "type", "details", "reference",
                "paymentMethod", "udhar", "paid", "balance", "cancelled"
            ]
        });

        const csv = parser.parse(data);

        const safeName = customer.customerName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

        res.header("Content-Type", "text/csv");
        res.header("X-Statement-Rows", String(rows.length));
        res.header("X-Statement-Truncated", String(truncated));
        res.header("X-Statement-Closing-Balance", String(closingBalance));
        res.attachment(`udhar-${safeName}-${new Date().toISOString().slice(0, 10)}.csv`);

        return res.send(csv);

    } catch (error) {
        console.log("Export statement error:", error);

        return res.status(500).json({ message: "Failed to export the statement" });
    }
};

// ---------------------------------------------------------------------------
// GET /udhar/customer/:id/reminder — the words for a polite reminder
//
// The server only composes the text; nothing is sent. The owner copies it or
// opens their own WhatsApp with it, exactly as the invoice screen works.
// ---------------------------------------------------------------------------
export const getReminder = async (req, res) => {
    try {
        const userId = req.user.id;

        const customer = await loadCustomer(userId, req.params.id);

        if (customer === "invalid") {
            return res.status(400).json({ message: "Invalid customer id" });
        }

        if (!customer) {
            return res.status(404).json({ message: "Customer not found" });
        }

        const totals = await getCustomerTotals(userId, customer._id);

        if (totals.outstanding <= 0) {
            return res.status(400).json({
                message: "This customer has nothing outstanding",
                outstanding: totals.outstanding
            });
        }

        const shop = await userModel
            .findById(userId)
            .select("Shopname ownerName mobileNumber shopAddress city upiId")
            .lean();

        const lastPaid = await creditTransactionModel
            .findOne({ userId, customerId: customer._id, type: "PAYMENT" })
            .sort({ date: -1 })
            .select("date amount")
            .lean();

        const money = (value) => `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        // Only ever this one customer's figures — nothing about anybody else.
        const message = [
            `Namaste ${customer.customerName},`,
            "",
            `This is a gentle reminder from ${shop?.Shopname || "our shop"}.`,
            `Your outstanding balance is ${money(totals.outstanding)}.`,
            lastPaid
                ? `Last payment received: ${money(lastPaid.amount)} on ${new Date(lastPaid.date).toLocaleDateString("en-IN")}.`
                : null,
            "",
            "Please pay at your convenience. Do let us know if you have any questions.",
            "",
            shop?.upiId ? `UPI: ${shop.upiId}` : null,
            shop?.mobileNumber ? `Call us: ${shop.mobileNumber}` : null,
            [shop?.shopAddress, shop?.city].filter(Boolean).join(", ") || null,
            "",
            `Thank you,`,
            shop?.Shopname || shop?.ownerName || ""
        ].filter((line) => line !== null).join("\n");

        return res.status(200).json({
            message: "Reminder ready",
            reminder: {
                text: message,
                outstanding: totals.outstanding,
                customerName: customer.customerName,
                // 10 digits get the country code so wa.me opens the right chat.
                whatsappPhone: customer.phone?.length === 10 ? `91${customer.phone}` : customer.phone || ""
            }
        });

    } catch (error) {
        console.log("Build reminder error:", error);

        return res.status(500).json({ message: "Server error" });
    }
};
