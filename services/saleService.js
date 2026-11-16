import mongoose from "mongoose";

import productModel from "../model/product.js";

/**
 * The pricing and stock rules every sale goes through — a counter bill, a
 * quick note, or goods taken on udhar.
 *
 * Lifted out of controllers/orderControllers.js unchanged so that credit
 * sales cannot drift away from billing: one place decides what an item
 * costs and one place moves stock.
 */

/** Thrown when the stock went while we were adding up the bill. */
export const STOCK_RACE_ERROR = "Product does not have enough stock";

/**
 * Rupees and paise, and nothing finer.
 *
 * Adding prices in binary floating point drifts: ₹10.05 + ₹10.15 comes out as
 * 20.200000000000003. Left alone that reaches the database, and the ledger —
 * which insists money is whole paise — refuses a perfectly ordinary basket.
 */
const toPaise = (value) => Math.round(Number(value) * 100) / 100;

export const roundBillTotal = (amount) => {
    const total = toPaise(amount);
    const grandTotal = Math.round(total);

    return {
        grandTotal,
        roundOff: toPaise(grandTotal - total)
    };
};

/** An error the caller can hand straight back to the client. */
const fail = (status, message) => {
    const error = new Error(message);

    error.status = status;
    error.isSaleError = true;

    return error;
};

export const isSaleError = (error) => Boolean(error?.isSaleError);

/**
 * Turns requested { productId, quantity } lines into order items priced from
 * this shop's own products, and adds them up.
 *
 * Prices come from the product, not the client. `allowPriceOverride` lets the
 * owner name a different price for one sale — the same freedom the Sales Note
 * page already gives for bargaining and loose weights — and is off for
 * counter billing.
 */
export const buildSaleItems = async ({
    userId,
    items,
    session = null,
    allowPriceOverride = false,
    allowTaxRateOverride = false
}) => {
    if (!items || items.length === 0) {
        throw fail(400, "Cart is empty");
    }

    const orderItems = [];
    let subtotal = 0;

    for (const item of items) {
        if (!mongoose.Types.ObjectId.isValid(item.productId)) {
            throw fail(400, "Invalid product ID");
        }

        const query = productModel.findOne({
            _id: item.productId,
            userId
        });

        const product = await (session ? query.session(session) : query);

        if (!product) {
            throw fail(404, "Product not found");
        }

        // Quantities can be fractional for loose goods (1.5 kg, 2.5 m).
        if (!(Number(item.quantity) > 0)) {
            throw fail(400, "Invalid quantity");
        }

        if (product.stock < item.quantity) {
            throw fail(
                400,
                `${product.productName} has only ${product.stock} ${product.unit || "units"} in stock`
            );
        }

        const overridden =
            allowPriceOverride && item.price !== undefined && item.price !== "" && item.price !== null;

        const price = overridden ? Number(item.price) : product.sellingPrice;

        if (!(price >= 0)) {
            throw fail(400, "Price cannot be negative");
        }

        let taxRate;
        if (allowTaxRateOverride) {
            const hasTaxRate = Object.prototype.hasOwnProperty.call(item, "taxRate");
            taxRate = hasTaxRate ? Number(item.taxRate) : Number(product.taxRate) || 0;

            if (
                (hasTaxRate && (item.taxRate === null || item.taxRate === "")) ||
                !Number.isFinite(taxRate) ||
                taxRate < 0 ||
                taxRate > 100
            ) {
                throw fail(400, "GST rate must be between 0 and 100");
            }
        }

        const total = toPaise(price * item.quantity);

        subtotal += total;

        orderItems.push({
            productId: product._id,
            productName: product.productName,
            hsnCode: product.hsnCode || "",
            price,
            quantity: Number(item.quantity),
            unit: product.unit || "piece",
            total,
            ...(allowTaxRateOverride ? { taxRate } : {})
        });
    }

    return { orderItems, subtotal: toPaise(subtotal) };
};

/** Bill-level discount and tax, exactly as the billing screen sends them. */
export const applySaleTotals = ({ subtotal, discount = 0, tax = 0 }) => {
    const discountAmount = toPaise(Number(discount) || 0);
    const taxAmount = toPaise(Number(tax) || 0);

    const grandTotal = toPaise(subtotal - discountAmount + taxAmount);

    if (grandTotal < 0) {
        throw fail(400, "Invalid total amount");
    }

    return { discount: discountAmount, tax: taxAmount, grandTotal };
};

/** Applies per-item GST after the bill discount, then splits it into CGST/SGST. */
export const applyItemTaxes = ({ orderItems, subtotal, discount = 0 }) => {
    const discountRatio = subtotal > 0 ? (subtotal - discount) / subtotal : 0;
    const discountedSubtotal = toPaise(subtotal - discount);
    let cgst = 0;
    let sgst = 0;
    let allocatedTaxableAmount = 0;

    const taxedItems = orderItems.map((item, index) => {
        const taxableAmount = index === orderItems.length - 1
            ? toPaise(discountedSubtotal - allocatedTaxableAmount)
            : toPaise(item.total * discountRatio);
        allocatedTaxableAmount += taxableAmount;

        const lineTax = toPaise(taxableAmount * (Number(item.taxRate) || 0) / 100);
        const lineCgst = toPaise(lineTax / 2);
        const lineSgst = toPaise(lineTax - lineCgst);

        cgst += lineCgst;
        sgst += lineSgst;

        return {
            ...item,
            taxableAmount,
            cgst: lineCgst,
            sgst: lineSgst,
            amount: toPaise(taxableAmount + lineTax)
        };
    });

    cgst = toPaise(cgst);
    sgst = toPaise(sgst);

    return {
        orderItems: taxedItems,
        cgst,
        sgst,
        tax: toPaise(cgst + sgst)
    };
};

/**
 * Takes the goods off the shelf. The condition and the decrement are one
 * atomic operation per product, so two bills for the last packet cannot both
 * succeed.
 *
 * On failure the thrown error carries `applied` — the lines that did come
 * off — so a caller without transactions can put exactly those back.
 */
export const deductStockForItems = async ({ userId, items, session = null }) => {
    const applied = [];

    for (const item of items) {
        const updated = await productModel.findOneAndUpdate(
            {
                _id: item.productId,
                userId,
                stock: { $gte: item.quantity }
            },
            {
                $inc: { stock: -item.quantity }
            },
            {
                new: true,
                ...(session ? { session } : {})
            }
        );

        if (!updated) {
            const error = new Error(STOCK_RACE_ERROR);
            error.applied = applied;

            throw error;
        }

        applied.push(item);
    }

    return applied;
};

/** Puts stock back — a cancelled credit sale, or a half-done deduction. */
export const restoreStockForItems = async ({ userId, items, session = null }) => {
    for (const item of items) {
        await productModel.findOneAndUpdate(
            { _id: item.productId, userId },
            { $inc: { stock: item.quantity } },
            { ...(session ? { session } : {}) }
        );
    }
};
