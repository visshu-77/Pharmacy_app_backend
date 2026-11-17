import mongoose from "mongoose";
import orderModel from "../model/order.js";
import { withTransaction } from "../services/dbSession.js";
import {
    applyItemTaxes,
    applySaleTotals,
    buildSaleItems,
    deductStockForItems,
    isSaleError,
    roundBillTotal,
    restoreStockForItems,
    STOCK_RACE_ERROR
} from "../services/saleService.js";

export const deleteOrder = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid bill id" });
        }

        const result = await withTransaction(
            async (session) => {
                const order = await orderModel.findOne({
                    _id: id,
                    userId: req.user.id
                }).session(session);

                if (!order) return "not-found";
                if (order.source === "credit" || order.source === "note") return "not-deletable";

                if (order.paymentStatus !== "Cancelled") {
                    await restoreStockForItems({
                        userId: req.user.id,
                        items: order.items,
                        session
                    });
                }

                await orderModel.deleteOne({ _id: id, userId: req.user.id }).session(session);
                return "deleted";
            },
            {
                fallback: async () => {
                    const order = await orderModel.findOneAndUpdate(
                        {
                            _id: id,
                            userId: req.user.id,
                            source: { $nin: ["credit", "note"] },
                            paymentStatus: { $ne: "Cancelled" }
                        },
                        { $set: { paymentStatus: "Cancelled" } },
                        { new: false }
                    );

                    if (order) {
                        await restoreStockForItems({
                            userId: req.user.id,
                            items: order.items
                        });
                        await orderModel.deleteOne({ _id: id, userId: req.user.id });
                        return "deleted";
                    }

                    const existingOrder = await orderModel.findOne({
                        _id: id,
                        userId: req.user.id
                    });
                    if (!existingOrder) return "not-found";
                    if (existingOrder.source === "credit" || existingOrder.source === "note") return "not-deletable";

                    await orderModel.deleteOne({ _id: id, userId: req.user.id });
                    return "deleted";
                }
            }
        );

        if (result === "not-found") {
            return res.status(404).json({ message: "Bill not found" });
        }
        if (result === "not-deletable") {
            return res.status(409).json({
                message: "Credit bills must be cancelled from the customer's ledger."
            });
        }

        return res.status(200).json({ message: "Bill deleted successfully" });
    } catch (error) {
        console.log("Delete bill error:", error);
        return res.status(500).json({ message: "Could not delete bill" });
    }
};

export const getOrderHistory = async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
        const filter = {
            userId: req.user.id,
            source: { $ne: "note" }
        };
        const [orders, total] = await Promise.all([
            orderModel
                .find(filter)
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            orderModel.countDocuments(filter)
        ]);

        return res.status(200).json({
            orders,
            page,
            hasMore: page * limit < total
        });
    } catch (error) {
        console.log("Get order history error:", error);
        return res.status(500).json({ message: "Could not load billing history" });
    }
};

export const createOrder = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const {
            items,
            customerName,
            customerPhone,
            discount = 0,
            tax = 0,
            paymentMethod
        } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({
                message: "Cart is empty"
            });
        }

        if (!paymentMethod) {
            return res.status(400).json({
                message: "Payment method is required"
            });
        }

        const hasItemTaxRates = items.some((item) =>
            Object.prototype.hasOwnProperty.call(item, "taxRate")
        );

        if (hasItemTaxRates && items.some((item) =>
            !Object.prototype.hasOwnProperty.call(item, "taxRate")
        )) {
            return res.status(400).json({
                message: "GST rate is required for every item"
            });
        }

        // Prices, stock checks and totals are the shared sale rules — the
        // same ones a credit sale goes through.
        let { orderItems, subtotal } = await buildSaleItems({
            userId: req.user.id,
            items,
            session,
            allowTaxRateOverride: hasItemTaxRates
        });

        let totals;
        let cgst;
        let sgst;
        if (hasItemTaxRates) {
            const discountedTotals = applySaleTotals({ subtotal, discount });
            const taxBreakdown = applyItemTaxes({
                orderItems,
                subtotal,
                discount: discountedTotals.discount
            });
            orderItems = taxBreakdown.orderItems;
            cgst = taxBreakdown.cgst;
            sgst = taxBreakdown.sgst;
            totals = applySaleTotals({
                subtotal,
                discount: discountedTotals.discount,
                tax: taxBreakdown.tax
            });
        } else {
            totals = applySaleTotals({ subtotal, discount, tax });
            cgst = Math.round(totals.tax / 2 * 100) / 100;
            sgst = Math.round((totals.tax - cgst) * 100) / 100;
        }

        const { grandTotal, roundOff } = roundBillTotal(totals.grandTotal);
        const invoiceNumber =
            `INV-${Date.now()}`;

        const order = await orderModel.create([{
            invoiceNumber,
            userId: req.user.id,
            // Most counter sales are walk-ins; a name is optional.
            customerName: (customerName || "").trim() || "Walk-in customer",
            customerPhone: (customerPhone || "").trim(),
            items: orderItems,
            subtotal,
            discount: totals.discount,
            tax: totals.tax,
            cgst,
            sgst,
            roundOff,
            grandTotal,
            paymentMethod,
            paymentStatus: "Paid"
        }],
        {
            session
        }
        );

        await deductStockForItems({
            userId: req.user.id,
            items: orderItems,
            session
        });

        await session.commitTransaction();
        return res.status(201).json({
            message: "Order created successfully",
            order: order[0]
        });
    } catch (error) {
        if (session.inTransaction()) {
            await session.abortTransaction();
        }

        // A rejected line (bad id, missing product, not enough stock) is the
        // customer's problem to fix, not a server fault.
        if (isSaleError(error)) {
            return res.status(error.status).json({
                message: error.message
            });
        }

        console.log("Create order error:", error);

        // Stock ran out between the check and the decrement (another bill).
        if (error.message === STOCK_RACE_ERROR) {
            return res.status(409).json({
                message: "Stock changed while billing. Please review quantities and try again."
            });
        }

        return res.status(500).json({
            message: "Server error"
        });
    } finally {
       await session.endSession();
    }
};
