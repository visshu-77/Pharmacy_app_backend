import mongoose from "mongoose";

import orderModel from "../model/order.js";
import productModel from "../model/product.js";

const PAYMENT_METHODS = ["Cash", "Card", "UPI"];

const round2 = (value) => Math.round(Number(value) * 100) / 100;

/** [start, end) of a calendar day given as YYYY-MM-DD (server local time). */
const dayRange = (dateText) => {
    const base = dateText && /^\d{4}-\d{2}-\d{2}$/.test(dateText)
        ? new Date(`${dateText}T00:00:00`)
        : new Date();

    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return { start, end };
};

const noteInvoiceNumber = () =>
    `NOTE-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

/** Shape one note order for the client. */
const toEntry = (order) => {
    const item = order.items[0] || {};

    return {
        _id: order._id,
        invoiceNumber: order.invoiceNumber,
        productId: item.productId,
        productName: item.productName,
        unit: item.unit,
        quantity: item.quantity,
        price: item.price,
        total: order.grandTotal,
        paymentMethod: order.paymentMethod,
        remark: order.remark,
        createdAt: order.createdAt
    };
};

/**
 * Take `quantity` out of stock only if that much is there. The condition and
 * the decrement are one atomic operation, so two counters noting the last
 * packet at the same moment cannot both succeed.
 */
const takeStock = (userId, productId, quantity) =>
    productModel.findOneAndUpdate(
        { _id: productId, userId, stock: { $gte: quantity } },
        { $inc: { stock: -quantity } },
        { returnDocument: "after" }
    );

const returnStock = (userId, productId, quantity) =>
    productModel.findOneAndUpdate(
        { _id: productId, userId },
        { $inc: { stock: quantity } },
        { returnDocument: "after" }
    );

// ---------------------------------------------------------------------------
// GET /note?date=YYYY-MM-DD — the day's lines plus an end-of-day summary
// ---------------------------------------------------------------------------
export const getDayNote = async (req, res) => {
    try {
        // Prefer the browser's own day boundaries (?from=&to= ISO) so "today"
        // means the shop's today even when the server runs in UTC.
        const from = req.query.from ? new Date(req.query.from) : null;
        const to = req.query.to ? new Date(req.query.to) : null;

        const { start, end } =
            from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to > from
                ? { start: from, end: to }
                : dayRange(req.query.date);
        const userId = new mongoose.Types.ObjectId(req.user.id);

        const [noteOrders, billedOrders] = await Promise.all([
            orderModel
                .find({ userId, source: "note", createdAt: { $gte: start, $lt: end } })
                .sort({ createdAt: -1 }),
            orderModel
                .find({
                    userId,
                    source: { $ne: "note" },
                    paymentStatus: "Paid",
                    createdAt: { $gte: start, $lt: end }
                })
                .select("grandTotal")
        ]);

        const entries = noteOrders.map(toEntry);

        const byPayment = Object.fromEntries(PAYMENT_METHODS.map((method) => [method, 0]));
        const productMap = new Map();

        for (const entry of entries) {
            byPayment[entry.paymentMethod] = round2((byPayment[entry.paymentMethod] || 0) + entry.total);

            const key = String(entry.productId);
            const row = productMap.get(key) || {
                productId: entry.productId,
                productName: entry.productName,
                unit: entry.unit,
                quantity: 0,
                total: 0
            };

            row.quantity = round2(row.quantity + entry.quantity);
            row.total = round2(row.total + entry.total);
            productMap.set(key, row);
        }

        const noteTotal = round2(entries.reduce((sum, entry) => sum + entry.total, 0));
        const billedTotal = round2(billedOrders.reduce((sum, order) => sum + Number(order.grandTotal || 0), 0));

        return res.status(200).json({
            date: start,
            entries,
            summary: {
                noteTotal,
                noteEntries: entries.length,
                billedTotal,
                billedCount: billedOrders.length,
                dayTotal: round2(noteTotal + billedTotal),
                byPayment,
                byProduct: [...productMap.values()].sort((a, b) => b.total - a.total)
            }
        });

    } catch (error) {
        console.log("Get day note error:", error);

        return res.status(500).json({ message: "Server error" });
    }
};

// ---------------------------------------------------------------------------
// POST /note — { productId, quantity, price?, paymentMethod?, remark? }
// ---------------------------------------------------------------------------
export const addNoteEntry = async (req, res) => {
    try {
        const { productId, remark = "" } = req.body;
        const quantity = Number(req.body.quantity);
        const paymentMethod = PAYMENT_METHODS.includes(req.body.paymentMethod)
            ? req.body.paymentMethod
            : "Cash";

        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({ message: "Choose a product from your inventory" });
        }

        if (!(quantity > 0)) {
            return res.status(400).json({ message: "Quantity must be more than 0" });
        }

        const product = await productModel.findOne({ _id: productId, userId: req.user.id });

        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }

        // Price defaults to the product's selling price; the owner may
        // change it for this sale (bargaining, loose weight rounding…).
        const price = req.body.price === undefined || req.body.price === ""
            ? Number(product.sellingPrice || 0)
            : Number(req.body.price);

        if (!(price >= 0)) {
            return res.status(400).json({ message: "Price cannot be negative" });
        }

        const updated = await takeStock(req.user.id, productId, quantity);

        if (!updated) {
            return res.status(400).json({
                message: `Only ${product.stock} ${product.unit || "units"} of ${product.productName} in stock`
            });
        }

        const total = round2(price * quantity);

        try {
            const order = await orderModel.create({
                invoiceNumber: noteInvoiceNumber(),
                userId: req.user.id,
                customerName: "Quick note",
                items: [{
                    productId: product._id,
                    productName: product.productName,
                    price,
                    quantity,
                    unit: product.unit || "piece",
                    total
                }],
                subtotal: total,
                discount: 0,
                tax: 0,
                grandTotal: total,
                paymentMethod,
                paymentStatus: "Paid",
                source: "note",
                remark: String(remark).slice(0, 200)
            });

            return res.status(201).json({
                message: "Added to today's note",
                entry: toEntry(order),
                stock: updated.stock
            });

        } catch (createError) {
            // Couldn't record the sale — give the stock back.
            await returnStock(req.user.id, productId, quantity);
            throw createError;
        }

    } catch (error) {
        console.log("Add note entry error:", error);

        return res.status(500).json({ message: "Server error" });
    }
};

// ---------------------------------------------------------------------------
// PATCH /note/:id — { quantity?, price?, paymentMethod?, remark? }
// Stock moves by the difference in quantity.
// ---------------------------------------------------------------------------
export const updateNoteEntry = async (req, res) => {
    try {
        const order = await orderModel.findOne({
            _id: req.params.id,
            userId: req.user.id,
            source: "note"
        });

        if (!order) {
            return res.status(404).json({ message: "Note entry not found" });
        }

        const item = order.items[0];

        const quantity = req.body.quantity === undefined ? item.quantity : Number(req.body.quantity);
        const price = req.body.price === undefined || req.body.price === "" ? item.price : Number(req.body.price);

        if (!(quantity > 0)) {
            return res.status(400).json({ message: "Quantity must be more than 0" });
        }

        if (!(price >= 0)) {
            return res.status(400).json({ message: "Price cannot be negative" });
        }

        const delta = round2(quantity - item.quantity);
        let stock;

        if (delta > 0) {
            const updated = await takeStock(req.user.id, item.productId, delta);

            if (!updated) {
                const product = await productModel.findById(item.productId).select("stock unit");
                return res.status(400).json({
                    message: `Only ${product?.stock ?? 0} more ${product?.unit || "units"} in stock`
                });
            }

            stock = updated.stock;
        } else if (delta < 0) {
            const updated = await returnStock(req.user.id, item.productId, -delta);
            stock = updated?.stock;
        }

        const total = round2(price * quantity);

        item.quantity = quantity;
        item.price = price;
        item.total = total;
        order.subtotal = total;
        order.grandTotal = total;

        if (PAYMENT_METHODS.includes(req.body.paymentMethod)) {
            order.paymentMethod = req.body.paymentMethod;
        }

        if (req.body.remark !== undefined) {
            order.remark = String(req.body.remark).slice(0, 200);
        }

        await order.save();

        return res.status(200).json({
            message: "Note entry updated",
            entry: toEntry(order),
            stock
        });

    } catch (error) {
        console.log("Update note entry error:", error);

        return res.status(500).json({ message: "Server error" });
    }
};

// ---------------------------------------------------------------------------
// DELETE /note/:id — removes the line and puts the stock back
// ---------------------------------------------------------------------------
export const deleteNoteEntry = async (req, res) => {
    try {
        const order = await orderModel.findOneAndDelete({
            _id: req.params.id,
            userId: req.user.id,
            source: "note"
        });

        if (!order) {
            return res.status(404).json({ message: "Note entry not found" });
        }

        const item = order.items[0];
        const updated = item
            ? await returnStock(req.user.id, item.productId, item.quantity)
            : null;

        return res.status(200).json({
            message: "Entry removed and stock restored",
            stock: updated?.stock
        });

    } catch (error) {
        console.log("Delete note entry error:", error);

        return res.status(500).json({ message: "Server error" });
    }
};
