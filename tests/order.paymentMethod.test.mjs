import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";

import orderModel from "../model/order.js";

test("accepts Bank as a billing order payment method", async () => {
    const order = new orderModel({
        invoiceNumber: "INV-BANK-TEST",
        userId: new mongoose.Types.ObjectId(),
        items: [{
            productId: new mongoose.Types.ObjectId(),
            productName: "Test item",
            price: 10,
            quantity: 1,
            total: 10
        }],
        subtotal: 10,
        grandTotal: 10,
        paymentMethod: "Bank"
    });

    await order.validate();
});
