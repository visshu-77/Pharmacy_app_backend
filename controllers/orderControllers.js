import mongoose from "mongoose";
import orderModel from "../model/order.js";
import {
    applySaleTotals,
    buildSaleItems,
    deductStockForItems,
    isSaleError,
    STOCK_RACE_ERROR
} from "../services/saleService.js";

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

        // Prices, stock checks and totals are the shared sale rules — the
        // same ones a credit sale goes through.
        const { orderItems, subtotal } = await buildSaleItems({
            userId: req.user.id,
            items,
            session
        });

        const totals = applySaleTotals({ subtotal, discount, tax });

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
            grandTotal: totals.grandTotal,
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
