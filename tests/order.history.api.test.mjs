import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import mongoose from "mongoose";
import orderModel from "../model/order.js";
import {
    connectTestDb,
    createShop,
    disconnectTestDb,
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
