import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import mongoose from "mongoose";
import orderModel from "../model/order.js";
import {
    connectTestDb,
    createShop,
    createProduct,
    disconnectTestDb,
    stockOf,
    startApi
} from "./helpers.mjs";

let api;
let shop;
let otherShop;

before(async () => {
    await connectTestDb("storeflow_test_order_history_api");
    api = await startApi();
    shop = await createShop();
    otherShop = await createShop();
});

after(async () => {
    if (api) api.close();
    if (mongoose.connection.readyState === 1) {
        await disconnectTestDb();
    } else {
        await mongoose.disconnect();
    }
});

const createHistoryOrder = (owner, invoiceNumber, source = "billing") =>
    orderModel.create({
        invoiceNumber,
        userId: owner.userId,
        customerName: invoiceNumber,
        items: [],
        subtotal: 100,
        grandTotal: 100,
        paymentMethod: "Cash",
        ...(source === "credit" ? { paymentStatus: "Pending" } : {}),
        source
    });

test("order history is authenticated, excludes sales notes, and is scoped to the shop", async () => {
    await createHistoryOrder(shop, "INV-HISTORY-1");
    await createHistoryOrder(shop, "INV-HISTORY-2", "credit");
    await createHistoryOrder(shop, "NOTE-HISTORY-1", "note");
    await createHistoryOrder(otherShop, "INV-OTHER-1");

    const unauthenticated = await api.request("GET", "/order/history");
    const response = await api.request("GET", "/order/history?page=1&limit=1", { token: shop.token });
    const secondPage = await api.request("GET", "/order/history?page=2&limit=1", { token: shop.token });

    assert.equal(unauthenticated.status, 401);
    assert.equal(response.status, 200);
    assert.equal(response.body.orders.length, 1);
    assert.equal(response.body.hasMore, true);
    assert.equal(secondPage.body.orders.length, 1);
    assert.equal(secondPage.body.hasMore, false);

    const invoices = [...response.body.orders, ...secondPage.body.orders].map((order) => order.invoiceNumber);
    assert.ok(invoices.includes("INV-HISTORY-1"));
    assert.ok(invoices.includes("INV-HISTORY-2"));
    assert.ok(!invoices.includes("NOTE-HISTORY-1"));
    assert.ok(!invoices.includes("INV-OTHER-1"));
});

test("deleting a billing order removes it from dashboard totals and restores stock", async () => {
    const owner = await createShop();
    const product = await createProduct(owner, { stock: 4 });
    const order = await orderModel.create({
        invoiceNumber: "INV-DELETE-1",
        userId: owner.userId,
        customerName: "Delete test",
        items: [{
            productId: product._id,
            productName: product.productName,
            price: 100,
            quantity: 3,
            total: 300
        }],
        subtotal: 300,
        grandTotal: 300,
        paymentMethod: "Cash"
    });
    const creditOrder = await createHistoryOrder(owner, "INV-DELETE-CREDIT", "credit");

    const before = await api.request("GET", "/dashboard/summary", { token: owner.token });
    const unauthorizedDelete = await api.request("DELETE", `/order/${order._id}`, { token: otherShop.token });
    const creditDelete = await api.request("DELETE", `/order/${creditOrder._id}`, { token: owner.token });
    const deletion = await api.request("DELETE", `/order/${order._id}`, { token: owner.token });
    const after = await api.request("GET", "/dashboard/summary", { token: owner.token });

    assert.equal(before.body.summary.todaysRevenue, 300);
    assert.equal(unauthorizedDelete.status, 404);
    assert.equal(creditDelete.status, 409);
    assert.equal(deletion.status, 200);
    assert.equal(after.body.summary.todaysRevenue, 0);
    assert.equal(after.body.summary.ordersToday, 0);
    assert.equal(await stockOf(product._id), 7);
    assert.ok(await orderModel.findById(creditOrder._id));
});
