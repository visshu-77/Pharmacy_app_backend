import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";

import creditCustomerModel from "../model/creditCustomer.js";
import creditTransactionModel from "../model/creditTransaction.js";
import orderModel from "../model/order.js";
import productModel from "../model/product.js";
import { exportReport } from "../controllers/reportControllers.js";
import {
    connectTestDb,
    createProduct,
    createShop,
    disconnectTestDb,
    startApi,
    stockOf
} from "./helpers.mjs";

/**
 * Audit regressions — each of these was written against a defect found while
 * reviewing the feature, and each failed before the fix that follows it.
 */

let api;
let shop;
let otherShop;
let customer;

before(async () => {
    await connectTestDb("storeflow_test_udhar_audit");

    api = await startApi();

    shop = await createShop();
    otherShop = await createShop();
});

after(async () => {
    api.close();
    await disconnectTestDb();
});

beforeEach(async () => {
    await Promise.all([
        creditCustomerModel.deleteMany({}),
        creditTransactionModel.deleteMany({}),
        orderModel.deleteMany({}),
        productModel.deleteMany({})
    ]);

    customer = await creditCustomerModel.create({
        userId: shop.userId,
        customerName: "Ramesh Kumar",
        phone: "9876543210"
    });
});

const as = (owner) => ({
    post: (path, body) => api.request("POST", path, { token: owner.token, body }),
    get: (path) => api.request("GET", path, { token: owner.token })
});

/** Calls a controller directly and captures what it replied. */
const callController = async (handler, request) => {
    let payload;

    const res = {
        status(code) { this.code = code; return this; },
        json(body) { payload = { code: this.code || 200, body }; return this; },
        send(body) { payload = { code: this.code || 200, body }; return this; },
        header() { return this; },
        attachment() { return this; }
    };

    await handler(request, res);

    return payload;
};

// ------------------------------------------- rupee arithmetic on a sale

test("prices that do not add up cleanly in binary still save", async () => {
    // ₹10.05 + ₹10.15 is 20.200000000000003 in floating point. Before the fix
    // the ledger's "rupees and paise" rule rejected the whole sale, so a
    // perfectly ordinary two-item basket could not be put on the khata.
    const a = await createProduct(shop, { productName: "Clip", stock: 10, sellingPrice: 10.05 });
    const b = await createProduct(shop, { productName: "Band", stock: 10, sellingPrice: 10.15 });

    const response = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [
            { productId: a._id, quantity: 1 },
            { productId: b._id, quantity: 1 }
        ]
    });

    assert.equal(response.status, 201, `expected the sale to save, got: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.transaction.amount, 20.2);
    assert.equal(response.body.order.subtotal, 20.2);
    assert.equal(response.body.balanceAfter, 20.2);
});

test("a discount and tax that drift in floating point still save", async () => {
    const item = await createProduct(shop, { productName: "Oil", stock: 10, sellingPrice: 1.05 });

    // 1.05 × 1.5 rounds to 1.58; plus a 1.20 tax that lands on 2.7800000000000002.
    const response = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [{ productId: item._id, quantity: 1.5 }],
        tax: 1.2
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.transaction.amount, 2.78);
});

test("an amount finer than a paisa is refused with a readable message", async () => {
    const item = await createProduct(shop, { productName: "Rice", stock: 10, sellingPrice: 100 });

    const response = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [{ productId: item._id, quantity: 1 }],
        tax: 0.005
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /paise|decimal/i);

    // And nothing was written on the way out.
    assert.equal(await creditTransactionModel.countDocuments({}), 0);
    assert.equal(await orderModel.countDocuments({}), 0);
    assert.equal(await stockOf(item._id), 10);
});

test("a custom amount finer than a paisa is refused", async () => {
    const response = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        amount: 10.005
    });

    assert.equal(response.status, 400);
    assert.equal(await creditTransactionModel.countDocuments({}), 0);
});

// -------------------------------------- a unique-key clash is not a success

test("a duplicate-key failure is never reported as 'already recorded'", async () => {
    const item = await createProduct(shop, { productName: "Rice", stock: 10, sellingPrice: 100 });

    // An invoice number collision is a different unique index from the
    // idempotency key. Before the fix this answered 200 "Already recorded"
    // with no transaction, so the till looked right and nothing was saved.
    const realCreate = orderModel.create.bind(orderModel);

    orderModel.create = async () => {
        const error = new Error("E11000 duplicate key error: invoiceNumber");
        error.code = 11000;
        throw error;
    };

    try {
        const response = await as(shop).post("/udhar/credit", {
            customerId: customer._id,
            items: [{ productId: item._id, quantity: 1 }]
        });

        assert.notEqual(response.status, 200, "a failed write must not answer 200");
        assert.equal(response.body.duplicate, undefined);

    } finally {
        orderModel.create = realCreate;
    }

    assert.equal(await creditTransactionModel.countDocuments({}), 0);
    assert.equal(await stockOf(item._id), 10, "the stock must be back");
});

test("a repeat with the same key still returns the first entry", async () => {
    const body = {
        customerId: customer._id,
        amount: 250,
        idempotencyKey: "same-key"
    };

    const first = await as(shop).post("/udhar/credit", body);
    const second = await as(shop).post("/udhar/credit", body);

    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal(String(second.body.transaction._id), String(first.body.transaction._id));
    assert.equal(await creditTransactionModel.countDocuments({}), 1);
});

// ------------------------------------------------- the sales CSV export

test("the sales report CSV does not sell goods twice", async () => {
    const rice = await createProduct(shop, { productName: "Rice", stock: 50, sellingPrice: 110 });

    await orderModel.create({
        invoiceNumber: `INV-${Date.now()}`,
        userId: shop.userId,
        customerName: "Walk-in customer",
        items: [{ productId: rice._id, productName: "Rice", price: 110, quantity: 1, unit: "kg", total: 110 }],
        subtotal: 110,
        grandTotal: 110,
        paymentMethod: "Cash",
        paymentStatus: "Paid"
    });

    const sale = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [{ productId: rice._id, quantity: 5 }]      // ₹550 on credit
    });

    assert.equal(sale.status, 201);

    const csv = await callController(exportReport, { user: { id: shop.userId }, query: {} });

    assert.equal(csv.code, 200);

    // Before the fix the credit sale was a row in the sales export, so adding
    // up the amount column counted ₹550 that nobody had paid.
    assert.equal(csv.body.includes("550"), false, "an unpaid credit sale is not a sale");
    assert.match(csv.body, /110/);

    const rows = csv.body.trim().split("\n");
    assert.equal(rows.length, 2, "a header and the one real sale");
});

test("a cancelled sale is not in the CSV either", async () => {
    const rice = await createProduct(shop, { productName: "Rice", stock: 50, sellingPrice: 110 });

    const order = await orderModel.create({
        invoiceNumber: `INV-${Date.now()}`,
        userId: shop.userId,
        customerName: "Walk-in customer",
        items: [{ productId: rice._id, productName: "Rice", price: 110, quantity: 2, unit: "kg", total: 220 }],
        subtotal: 220,
        grandTotal: 220,
        paymentMethod: "Cash",
        paymentStatus: "Cancelled"
    });

    assert.ok(order._id);

    const csv = await callController(exportReport, { user: { id: shop.userId }, query: {} });

    // Nothing paid at all, so there is nothing to export.
    assert.equal(csv.code, 404);
});

test("the CSV still exports a normal shop's sales untouched", async () => {
    const rice = await createProduct(shop, { productName: "Rice", stock: 50, sellingPrice: 110 });

    for (let i = 0; i < 3; i += 1) {
        await orderModel.create({
            invoiceNumber: `INV-${Date.now()}-${i}`,
            userId: shop.userId,
            customerName: "Walk-in customer",
            items: [{ productId: rice._id, productName: "Rice", price: 110, quantity: 1, unit: "kg", total: 110 }],
            subtotal: 110,
            grandTotal: 110,
            paymentMethod: "Cash",
            paymentStatus: "Paid"
        });
    }

    const csv = await callController(exportReport, { user: { id: shop.userId }, query: {} });

    assert.equal(csv.code, 200);
    assert.equal(csv.body.trim().split("\n").length, 4);
    assert.equal(csv.body.includes(String(otherShop.userId)), false);
});

// -------------------------------------------------------- traceability

test("a cancelled entry and its reversal both stay in the statement", async () => {
    const entry = await as(shop).post("/udhar/credit", {
        customerId: customer._id, amount: 400, description: "Diwali goods"
    });

    await as(shop).post(`/udhar/transaction/${entry.body.transaction._id}/reverse`, {
        reason: "Wrong customer"
    });

    const statement = await as(shop).get(`/udhar/transactions?customerId=${customer._id}`);

    assert.equal(statement.body.transactions.length, 2);

    const [original, reversal] = statement.body.transactions;

    assert.equal(original.description, "Diwali goods");
    assert.equal(original.isReversed, true);
    assert.equal(reversal.reason, "Wrong customer");
    assert.equal(String(reversal.reversalOf), String(original._id));
    assert.equal(reversal.runningBalance, 0);

    // Still readable after the fact, which is the whole point of a reversal.
    assert.equal(statement.body.summary.closingBalance, 0);
});

// ------------------------------------------------------------- reminders

test("a customer in credit gets no reminder", async () => {
    await as(shop).post("/udhar/credit", { customerId: customer._id, amount: 100 });
    await as(shop).post("/udhar/payment", {
        customerId: customer._id, amount: 100, paymentMethod: "Cash"
    });

    const response = await as(shop).get(`/udhar/customer/${customer._id}/reminder`);

    assert.equal(response.status, 400);
    assert.match(response.body.message, /nothing outstanding/);
});

// --------------------------------------------------- combined filtering

test("type and method filters combine, and the balance ignores both", async () => {
    await as(shop).post("/udhar/credit", { customerId: customer._id, amount: 1000 });
    await as(shop).post("/udhar/payment", {
        customerId: customer._id, amount: 100, paymentMethod: "Cash", idempotencyKey: "a"
    });
    await as(shop).post("/udhar/payment", {
        customerId: customer._id, amount: 200, paymentMethod: "UPI", idempotencyKey: "b"
    });

    const combined = await as(shop).get(
        `/udhar/transactions?customerId=${customer._id}&type=PAYMENT&paymentMethod=UPI`
    );

    assert.deepEqual(combined.body.transactions.map((row) => row.amount), [200]);
    assert.equal(combined.body.summary.closingBalance, 700);
});

// -------------------------------------------- ownership on every surface

test("no udhar surface answers for another shop", async () => {
    const theirs = await creditCustomerModel.create({
        userId: otherShop.userId, customerName: "Theirs", phone: "9700000009"
    });

    const theirEntry = await creditTransactionModel.create({
        userId: otherShop.userId, createdBy: otherShop.userId,
        customerId: theirs._id, type: "CREDIT_SALE", amount: 123
    });

    const mine = as(shop);

    const checks = [
        ["GET", `/udhar/customer/single/${theirs._id}`],
        ["GET", `/udhar/transactions?customerId=${theirs._id}`],
        ["GET", `/udhar/customer/${theirs._id}/reminder`],
        ["GET", `/udhar/statement/export?customerId=${theirs._id}`]
    ];

    for (const [method, path] of checks) {
        const response = await api.request(method, path, { token: shop.token });

        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.stringify(response.body ?? "").includes("123"), false);
    }

    const patched = await api.request("PATCH", `/udhar/transaction/${theirEntry._id}`, {
        token: shop.token,
        body: { description: "tampered" }
    });

    assert.equal(patched.status, 404);

    assert.equal(
        (await creditTransactionModel.findById(theirEntry._id)).description,
        ""
    );

    // The other shop's own summary is unaffected by any of that.
    const theirSummary = await as(otherShop).get("/udhar/summary");
    assert.equal(theirSummary.body.summary.outstanding, 123);
});

// ------------------------------------------- the sales note still adds up

test("the sales note's day total ignores udhar, and its own entries still work", async () => {
    const rice = await createProduct(shop, { productName: "Rice", stock: 50, sellingPrice: 110 });

    // A quick note sale: this is real cash and must still count.
    const note = await as(shop).post("/note", {
        productId: rice._id,
        quantity: 2,
        paymentMethod: "Cash"
    });

    assert.equal(note.status, 201);
    assert.equal(note.body.entry.total, 220);
    assert.equal(await stockOf(rice._id), 48);

    // A credit sale on the same day must not show up in the day's takings.
    const credit = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [{ productId: rice._id, quantity: 3 }]
    });

    assert.equal(credit.status, 201);

    const day = await as(shop).get("/note");

    assert.equal(day.status, 200);
    assert.equal(day.body.summary.noteTotal, 220, "the note's own sale still counts");
    assert.equal(day.body.summary.billedTotal, 0, "udhar is not a billed sale");
    assert.equal(day.body.summary.dayTotal, 220, "the day's takings exclude udhar");
    assert.equal(day.body.entries.length, 1);

    // Stock moved for both, once each.
    assert.equal(await stockOf(rice._id), 45);
});

test("deleting a note entry still restores its stock", async () => {
    const rice = await createProduct(shop, { productName: "Rice", stock: 20, sellingPrice: 110 });

    const note = await as(shop).post("/note", {
        productId: rice._id, quantity: 5, paymentMethod: "Cash"
    });

    assert.equal(await stockOf(rice._id), 15);

    const removed = await api.request("DELETE", `/note/${note.body.entry._id}`, { token: shop.token });

    assert.equal(removed.status, 200);
    assert.equal(await stockOf(rice._id), 20);
});
