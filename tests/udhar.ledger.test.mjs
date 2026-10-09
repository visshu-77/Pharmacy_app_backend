import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";

import mongoose from "mongoose";

import creditCustomerModel from "../model/creditCustomer.js";
import creditTransactionModel from "../model/creditTransaction.js";
import orderModel from "../model/order.js";
import productModel from "../model/product.js";
import { getSalesData } from "../services/reportDataService.js";
import { getRecentTransactions } from "../controllers/reportControllers.js";
import {
    connectTestDb,
    createProduct,
    createShop,
    disconnectTestDb,
    startApi,
    stockOf,
    supportsTransactions
} from "./helpers.mjs";

/**
 * Phase 2: credit sales, repayments, statements and cancellations.
 *
 * The same suite runs on a replica set (real transactions) and on a plain
 * mongod (compensating writes), because both paths have to behave the same.
 */

let api;
let shop;
let otherShop;
let customer;
let transactional;

before(async () => {
    await connectTestDb("storeflow_test_udhar_ledger");

    api = await startApi();
    transactional = await supportsTransactions();

    console.log(
        transactional
            ? "   (running against a replica set — real MongoDB transactions)"
            : "   (running against a standalone mongod — compensating writes)"
    );

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
    patch: (path, body) => api.request("PATCH", path, { token: owner.token, body }),
    get: (path) => api.request("GET", path, { token: owner.token })
});

const owed = async (customerId = customer._id) => {
    const response = await as(shop).get(`/udhar/customer/single/${customerId}`);

    return response.body.customer.outstanding;
};

// --------------------------------------------------------- A. credit sales

test("a credit sale of one product moves stock once and raises the balance", async () => {
    const rice = await createProduct(shop, { productName: "Rice 5kg", stock: 20, sellingPrice: 110 });

    const response = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [{ productId: rice._id, quantity: 2 }]
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.transaction.amount, 220);
    assert.equal(response.body.balanceBefore, 0);
    assert.equal(response.body.balanceAfter, 220);

    assert.equal(await stockOf(rice._id), 18);

    const order = await orderModel.findById(response.body.order._id);

    assert.equal(order.paymentMethod, "Credit");
    assert.equal(order.paymentStatus, "Pending");
    assert.equal(order.source, "credit");
    assert.equal(String(order.creditCustomerId), String(customer._id));
    assert.equal(order.customerName, "Ramesh Kumar");
    assert.match(order.invoiceNumber, /^UDH-/);

    const entry = await creditTransactionModel.findById(response.body.transaction._id);

    assert.equal(entry.type, "CREDIT_SALE");
    assert.equal(entry.direction, "increase");
    assert.equal(entry.entryMode, "product");
    assert.equal(String(entry.orderId), String(order._id));
    assert.equal(entry.items[0].productName, "Rice 5kg");

    // Exactly one order and one ledger row — no double booking.
    assert.equal(await orderModel.countDocuments({}), 1);
    assert.equal(await creditTransactionModel.countDocuments({}), 1);
});

test("a credit sale of several products prices, discounts and taxes like billing", async () => {
    const rice = await createProduct(shop, { productName: "Rice", stock: 20, sellingPrice: 110 });
    const oil = await createProduct(shop, { productName: "Oil", stock: 10, sellingPrice: 180 });

    const response = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [
            { productId: rice._id, quantity: 2 },      // 220
            { productId: oil._id, quantity: 1.5 }      // 270
        ],
        discount: 40,
        tax: 24.5,
        description: "Monthly ration"
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.order.subtotal, 490);
    assert.equal(response.body.transaction.amount, 474.5);   // 490 − 40 + 24.5
    assert.equal(response.body.balanceAfter, 474.5);

    assert.equal(await stockOf(rice._id), 18);
    assert.equal(await stockOf(oil._id), 8.5);
});

test("the owner may set the price for one sale, as on the Sales Note", async () => {
    const rice = await createProduct(shop, { productName: "Rice", stock: 20, sellingPrice: 110 });

    const response = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [{ productId: rice._id, quantity: 2, price: 100 }]
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.transaction.amount, 200);
});

test("a custom amount is written straight into the khata and moves no stock", async () => {
    const rice = await createProduct(shop, { stock: 20 });

    const response = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        amount: 500,
        description: "Old balance carried over"
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.transaction.entryMode, "custom");
    assert.equal(response.body.transaction.orderId, undefined);
    assert.equal(response.body.balanceAfter, 500);

    assert.equal(await stockOf(rice._id), 20);
    assert.equal(await orderModel.countDocuments({}), 0);
});

test("a sale with not enough stock changes nothing at all", async () => {
    const rice = await createProduct(shop, { productName: "Rice", stock: 3, sellingPrice: 110 });

    const response = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [{ productId: rice._id, quantity: 5 }]
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /has only 3 /);

    assert.equal(await stockOf(rice._id), 3);
    assert.equal(await orderModel.countDocuments({}), 0);
    assert.equal(await creditTransactionModel.countDocuments({}), 0);
    assert.equal(await owed(), 0);
});

test("one bad line stops the whole sale, leaving the good lines untouched", async () => {
    const rice = await createProduct(shop, { productName: "Rice", stock: 20, sellingPrice: 110 });
    const oil = await createProduct(shop, { productName: "Oil", stock: 1, sellingPrice: 180 });

    const response = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [
            { productId: rice._id, quantity: 2 },
            { productId: oil._id, quantity: 5 }
        ]
    });

    assert.equal(response.status, 400);
    assert.equal(await stockOf(rice._id), 20);
    assert.equal(await stockOf(oil._id), 1);
    assert.equal(await creditTransactionModel.countDocuments({}), 0);
});

test("a failure part-way through rolls the whole sale back", async () => {
    const rice = await createProduct(shop, { productName: "Rice", stock: 20, sellingPrice: 110 });

    // Fault injection: the stock is already off the shelf and the order is
    // written when the ledger write blows up. Nothing may survive that.
    const realCreate = creditTransactionModel.create.bind(creditTransactionModel);

    creditTransactionModel.create = async () => {
        throw new Error("ledger write failed");
    };

    try {
        const response = await as(shop).post("/udhar/credit", {
            customerId: customer._id,
            items: [{ productId: rice._id, quantity: 4 }]
        });

        assert.equal(response.status, 500);

    } finally {
        creditTransactionModel.create = realCreate;
    }

    assert.equal(await stockOf(rice._id), 20, "stock must go back on the shelf");
    assert.equal(await orderModel.countDocuments({}), 0, "the order must not survive");
    assert.equal(await creditTransactionModel.countDocuments({}), 0);
    assert.equal(await owed(), 0);
});

// ---------------------------------------------------------- B. repayments

test("a partial payment lowers the balance and reports both sides of it", async () => {
    await as(shop).post("/udhar/credit", { customerId: customer._id, amount: 1000 });

    const response = await as(shop).post("/udhar/payment", {
        customerId: customer._id,
        amount: 400,
        paymentMethod: "Cash"
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.balanceBefore, 1000);
    assert.equal(response.body.balanceAfter, 600);
    assert.equal(response.body.settled, false);
    assert.equal(response.body.transaction.direction, "decrease");

    assert.equal(await owed(), 600);
});

test("settleFull clears the khata without typing an amount", async () => {
    await as(shop).post("/udhar/credit", { customerId: customer._id, amount: 750.25 });

    const response = await as(shop).post("/udhar/payment", {
        customerId: customer._id,
        settleFull: true,
        paymentMethod: "UPI"
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.transaction.amount, 750.25);
    assert.equal(response.body.balanceAfter, 0);
    assert.equal(response.body.settled, true);

    assert.equal(await owed(), 0);
});

test("a payment cannot exceed what is owed", async () => {
    await as(shop).post("/udhar/credit", { customerId: customer._id, amount: 300 });

    const tooMuch = await as(shop).post("/udhar/payment", {
        customerId: customer._id,
        amount: 500,
        paymentMethod: "Cash"
    });

    assert.equal(tooMuch.status, 400);
    assert.match(tooMuch.body.message, /more than/);
    assert.equal(tooMuch.body.outstanding, 300);

    assert.equal(await owed(), 300);
    assert.equal(await creditTransactionModel.countDocuments({ type: "PAYMENT" }), 0);
});

test("invalid payment amounts are refused", async () => {
    await as(shop).post("/udhar/credit", { customerId: customer._id, amount: 1000 });

    for (const amount of [0, -50, "abc", 10.005, null]) {
        const response = await as(shop).post("/udhar/payment", {
            customerId: customer._id,
            amount,
            paymentMethod: "Cash"
        });

        assert.equal(response.status, 400, `amount ${amount}`);
    }

    const badMethod = await as(shop).post("/udhar/payment", {
        customerId: customer._id,
        amount: 100,
        paymentMethod: "Cheque"
    });

    assert.equal(badMethod.status, 400);

    assert.equal(await creditTransactionModel.countDocuments({ type: "PAYMENT" }), 0);
});

test("the same payment sent twice is recorded once", async () => {
    await as(shop).post("/udhar/credit", { customerId: customer._id, amount: 1000 });

    const body = {
        customerId: customer._id,
        amount: 250,
        paymentMethod: "Cash",
        idempotencyKey: "receipt-42"
    };

    const first = await as(shop).post("/udhar/payment", body);
    const second = await as(shop).post("/udhar/payment", body);

    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal(String(second.body.transaction._id), String(first.body.transaction._id));

    assert.equal(await creditTransactionModel.countDocuments({ type: "PAYMENT" }), 1);
    assert.equal(await owed(), 750);
});

test("a double tap with no key is caught too", async () => {
    await as(shop).post("/udhar/credit", { customerId: customer._id, amount: 1000 });

    const body = { customerId: customer._id, amount: 250, paymentMethod: "Cash" };

    const first = await as(shop).post("/udhar/payment", body);
    const second = await as(shop).post("/udhar/payment", body);

    assert.equal(first.status, 201);
    assert.equal(second.status, 409);
    assert.equal(second.body.duplicateSuspected, true);

    assert.equal(await creditTransactionModel.countDocuments({ type: "PAYMENT" }), 1);
});

test("two payments racing for the same balance cannot overdraw it", async () => {
    await as(shop).post("/udhar/credit", { customerId: customer._id, amount: 500 });

    // Different keys, so this is two genuine requests arriving together —
    // not a double tap.
    const [a, b] = await Promise.all([
        as(shop).post("/udhar/payment", {
            customerId: customer._id, amount: 500, paymentMethod: "Cash", idempotencyKey: "race-a"
        }),
        as(shop).post("/udhar/payment", {
            customerId: customer._id, amount: 500, paymentMethod: "UPI", idempotencyKey: "race-b"
        })
    ]);

    const accepted = [a, b].filter((response) => response.status === 201);
    const refused = [a, b].filter((response) => response.status !== 201);

    const balance = await owed();
    const recorded = await creditTransactionModel.countDocuments({ type: "PAYMENT" });

    // The safety property, on either path: the khata cannot be overdrawn and
    // the same money cannot be banked twice.
    assert.ok(balance >= 0, `the khata must never go negative, got ${balance}`);
    assert.ok(recorded <= 1, `at most one payment may survive, got ${recorded}`);
    assert.equal(balance, 500 - recorded * 500, "the balance matches what was recorded");
    refused.forEach((response) => assert.equal(response.status, 409));

    if (transactional) {
        // A transaction makes the two collide on the customer document, so
        // one is retried against the new balance and the other commits.
        assert.equal(accepted.length, 1, `exactly one should win, got ${a.status}/${b.status}`);
    } else {
        // Without transactions both writers may notice the overdraft after
        // the fact and withdraw their own row. Nothing is corrupted; both are
        // told to try again. See the fallback in creditLedgerController.
        assert.ok(
            accepted.length <= 1,
            `at most one should win, got ${a.status}/${b.status}`
        );
    }
});

// ------------------------------------------------------- C. ledger history

test("a statement opens, runs and closes on the right numbers", async () => {
    const day = (iso) => new Date(`${iso}T10:00:00.000Z`);

    await as(shop).post("/udhar/credit", {
        customerId: customer._id, amount: 1000, date: day("2026-01-05"), description: "January goods"
    });
    await as(shop).post("/udhar/payment", {
        customerId: customer._id, amount: 400, paymentMethod: "Cash", date: day("2026-01-20")
    });
    await as(shop).post("/udhar/credit", {
        customerId: customer._id, amount: 250, date: day("2026-02-08")
    });
    await as(shop).post("/udhar/payment", {
        customerId: customer._id, amount: 100, paymentMethod: "UPI", date: day("2026-02-15")
    });

    const february = await as(shop).get(
        `/udhar/transactions?customerId=${customer._id}&from=2026-02-01&to=2026-03-01`
    );

    assert.equal(february.status, 200);
    assert.equal(february.body.openingBalance, 600);      // what January left
    assert.deepEqual(
        february.body.transactions.map((row) => [row.amount, row.runningBalance]),
        [[250, 850], [100, 750]]
    );

    assert.equal(february.body.summary.charges, 250);
    assert.equal(february.body.summary.payments, 100);
    assert.equal(february.body.summary.closingBalance, 750);
    assert.equal(february.body.pagination.total, 2);

    // The whole khata, oldest first.
    const everything = await as(shop).get(`/udhar/transactions?customerId=${customer._id}`);

    assert.equal(everything.body.openingBalance, 0);
    assert.deepEqual(
        everything.body.transactions.map((row) => row.runningBalance),
        [1000, 600, 850, 750]
    );
});

test("the running balance carries across pages", async () => {
    for (let i = 0; i < 5; i += 1) {
        await as(shop).post("/udhar/credit", { customerId: customer._id, amount: 100 });
    }

    const first = await as(shop).get(`/udhar/transactions?customerId=${customer._id}&limit=2&page=1`);
    const second = await as(shop).get(`/udhar/transactions?customerId=${customer._id}&limit=2&page=2`);
    const third = await as(shop).get(`/udhar/transactions?customerId=${customer._id}&limit=2&page=3`);

    assert.deepEqual(first.body.transactions.map((row) => row.runningBalance), [100, 200]);
    assert.deepEqual(second.body.transactions.map((row) => row.runningBalance), [300, 400]);
    assert.deepEqual(third.body.transactions.map((row) => row.runningBalance), [500]);
    assert.equal(third.body.pagination.pages, 3);
});

test("the shop summary adds up what is owed and what moved", async () => {
    const second = await creditCustomerModel.create({
        userId: shop.userId,
        customerName: "Suresh"
    });

    await as(shop).post("/udhar/credit", { customerId: customer._id, amount: 1000 });
    await as(shop).post("/udhar/credit", { customerId: second._id, amount: 500 });
    await as(shop).post("/udhar/payment", {
        customerId: customer._id, amount: 300, paymentMethod: "Cash"
    });

    const response = await as(shop).get("/udhar/summary");

    assert.equal(response.status, 200);
    assert.deepEqual(
        {
            outstanding: response.body.summary.outstanding,
            dueCustomers: response.body.summary.dueCustomers,
            creditGiven: response.body.summary.creditGiven,
            paymentsCollected: response.body.summary.paymentsCollected
        },
        { outstanding: 1200, dueCustomers: 2, creditGiven: 1500, paymentsCollected: 300 }
    );
});

// -------------------------------------------------------- D. cancellations

test("cancelling a credit sale puts the goods back, exactly once", async () => {
    const rice = await createProduct(shop, { productName: "Rice", stock: 20, sellingPrice: 110 });

    const sale = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [{ productId: rice._id, quantity: 4 }]
    });

    assert.equal(await stockOf(rice._id), 16);

    const reversal = await as(shop).post(`/udhar/transaction/${sale.body.transaction._id}/reverse`, {
        reason: "Customer returned everything"
    });

    assert.equal(reversal.status, 201);
    assert.equal(reversal.body.outstanding, 0);
    assert.equal(await stockOf(rice._id), 20);

    const order = await orderModel.findById(sale.body.order._id);
    assert.equal(order.paymentStatus, "Cancelled");

    // History is intact: both rows are still there.
    assert.equal(await creditTransactionModel.countDocuments({}), 2);

    const original = await creditTransactionModel.findById(sale.body.transaction._id);
    assert.equal(original.isReversed, true);
    assert.equal(original.amount, 440);

    // A second attempt must not give the stock back twice.
    const again = await as(shop).post(`/udhar/transaction/${sale.body.transaction._id}/reverse`, {
        reason: "Trying again"
    });

    assert.equal(again.status, 409);
    assert.equal(await stockOf(rice._id), 20);
    assert.equal(await creditTransactionModel.countDocuments({}), 2);
});

test("cancelling a payment puts the debt back", async () => {
    await as(shop).post("/udhar/credit", { customerId: customer._id, amount: 1000 });

    const payment = await as(shop).post("/udhar/payment", {
        customerId: customer._id, amount: 400, paymentMethod: "Cash"
    });

    assert.equal(await owed(), 600);

    const reversal = await as(shop).post(`/udhar/transaction/${payment.body.transaction._id}/reverse`, {
        reason: "Recorded against the wrong customer"
    });

    assert.equal(reversal.status, 201);
    assert.equal(reversal.body.reversal.direction, "increase");
    assert.equal(await owed(), 1000);
});

test("a cancellation needs a reason and cannot itself be cancelled", async () => {
    const entry = await as(shop).post("/udhar/credit", { customerId: customer._id, amount: 100 });

    const noReason = await as(shop).post(`/udhar/transaction/${entry.body.transaction._id}/reverse`, {});
    assert.equal(noReason.status, 400);

    const tooShort = await as(shop).post(`/udhar/transaction/${entry.body.transaction._id}/reverse`, {
        reason: "x"
    });
    assert.equal(tooShort.status, 400);

    const done = await as(shop).post(`/udhar/transaction/${entry.body.transaction._id}/reverse`, {
        reason: "Entered twice"
    });
    assert.equal(done.status, 201);

    const onTheReversal = await as(shop).post(
        `/udhar/transaction/${done.body.reversal._id}/reverse`,
        { reason: "Undo the undo" }
    );
    assert.equal(onTheReversal.status, 409);
});

test("only the words of an entry can be edited, never the money", async () => {
    const entry = await as(shop).post("/udhar/credit", { customerId: customer._id, amount: 100 });
    const id = entry.body.transaction._id;

    const edited = await as(shop).patch(`/udhar/transaction/${id}`, {
        description: "Diwali goods",
        referenceNumber: "SLIP-9"
    });

    assert.equal(edited.status, 200);
    assert.equal(edited.body.transaction.description, "Diwali goods");

    const refused = await as(shop).patch(`/udhar/transaction/${id}`, { amount: 5 });

    assert.equal(refused.status, 400);
    assert.equal((await creditTransactionModel.findById(id)).amount, 100);
    assert.equal(await owed(), 100);
});

// --------------------------------------------------------------- security

test("nothing in another shop's khata can be touched", async () => {
    const theirCustomer = await creditCustomerModel.create({
        userId: otherShop.userId,
        customerName: "Their customer"
    });

    const theirEntry = await creditTransactionModel.create({
        userId: otherShop.userId,
        customerId: theirCustomer._id,
        createdBy: otherShop.userId,
        type: "CREDIT_SALE",
        amount: 900
    });

    const mine = as(shop);

    assert.equal((await mine.post("/udhar/credit", {
        customerId: theirCustomer._id, amount: 100
    })).status, 404);

    assert.equal((await mine.post("/udhar/payment", {
        customerId: theirCustomer._id, amount: 100, paymentMethod: "Cash"
    })).status, 404);

    assert.equal((await mine.get(
        `/udhar/transactions?customerId=${theirCustomer._id}`
    )).status, 404);

    assert.equal((await mine.post(`/udhar/transaction/${theirEntry._id}/reverse`, {
        reason: "Not mine to cancel"
    })).status, 404);

    assert.equal((await mine.patch(`/udhar/transaction/${theirEntry._id}`, {
        description: "Tampered"
    })).status, 404);

    // Their ledger is exactly as it was.
    assert.equal(await creditTransactionModel.countDocuments({ userId: otherShop.user._id }), 1);
    assert.equal((await creditTransactionModel.findById(theirEntry._id)).description, "");
});

test("another shop's product cannot be sold on your khata", async () => {
    const theirProduct = await createProduct(otherShop, { productName: "Their stock", stock: 50 });

    const response = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [{ productId: theirProduct._id, quantity: 1 }]
    });

    assert.equal(response.status, 404);
    assert.equal(response.body.message, "Product not found");
    assert.equal(await stockOf(theirProduct._id), 50);
});

test("the ledger routes need a plan, like the rest of the app", async () => {
    const unpaid = await createShop({ withSubscription: false });

    const response = await as(unpaid).post("/udhar/credit", {
        customerId: customer._id,
        amount: 100
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.subscriptionRequired, true);
});

// ------------------------------------------------- E. reporting regression

test("credit sales and repayments never reach the sales reports", async () => {
    const rice = await createProduct(shop, { productName: "Rice", stock: 100, sellingPrice: 110 });

    // A real cash bill through the existing billing route.
    if (transactional) {
        const bill = await as(shop).post("/order/create-order", {
            items: [{ productId: rice._id, quantity: 1 }],
            paymentMethod: "Cash"
        });

        assert.equal(bill.status, 201);
    } else {
        // Billing itself requires transactions; stand in for it with the
        // document it would have written, so the report check still means
        // something on a standalone server.
        await orderModel.create({
            invoiceNumber: `INV-${Date.now()}`,
            userId: shop.userId,
            customerName: "Walk-in customer",
            items: [{
                productId: rice._id, productName: "Rice", price: 110,
                quantity: 1, unit: "piece", total: 110
            }],
            subtotal: 110,
            grandTotal: 110,
            paymentMethod: "Cash",
            paymentStatus: "Paid"
        });

        // ...including the stock it would have taken off the shelf.
        await productModel.updateOne({ _id: rice._id }, { $inc: { stock: -1 } });
    }

    const before = await getSalesData(shop.userId);

    assert.equal(before.totalSales, 110);
    assert.equal(before.totalOrders, 1);

    // Now a credit sale and a repayment of it.
    const sale = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [{ productId: rice._id, quantity: 10 }]
    });

    assert.equal(sale.status, 201);

    await as(shop).post("/udhar/payment", {
        customerId: customer._id, amount: 600, paymentMethod: "Cash"
    });

    const after = await getSalesData(shop.userId);

    assert.deepEqual(after, before, "udhar must not change cash sales figures");

    // The report query itself: a credit order is never "Paid".
    assert.equal(
        await orderModel.countDocuments({ userId: shop.user._id, paymentStatus: "Paid" }),
        1
    );

    // And a repayment is not an order at all.
    assert.equal(await orderModel.countDocuments({ paymentMethod: "Cash" }), 1);

    // The stock did move, though — the goods really left the shop.
    assert.equal(await stockOf(rice._id), 89);
});

test("a cancelled credit sale stays out of the reports too", async () => {
    const rice = await createProduct(shop, { productName: "Rice", stock: 50, sellingPrice: 110 });

    const sale = await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [{ productId: rice._id, quantity: 2 }]
    });

    await as(shop).post(`/udhar/transaction/${sale.body.transaction._id}/reverse`, {
        reason: "Returned"
    });

    const sales = await getSalesData(shop.userId);

    assert.equal(sales.totalSales, 0);
    assert.equal(sales.totalOrders, 0);
});

// -------------------------------------------------- billing regression

test("counter billing still works exactly as before", async (t) => {
    if (!transactional) {
        t.skip("billing uses MongoDB transactions; needs a replica set");
        return;
    }

    const rice = await createProduct(shop, { productName: "Rice", stock: 10, sellingPrice: 110 });

    const ok = await as(shop).post("/order/create-order", {
        items: [{ productId: rice._id, quantity: 2 }],
        customerName: "Walk-in",
        discount: 20,
        tax: 10,
        paymentMethod: "Cash"
    });

    assert.equal(ok.status, 201);
    assert.equal(ok.body.order.subtotal, 220);
    assert.equal(ok.body.order.grandTotal, 210);
    assert.equal(ok.body.order.paymentStatus, "Paid");
    assert.equal(ok.body.order.source, "billing");
    assert.match(ok.body.order.invoiceNumber, /^INV-/);
    assert.equal(await stockOf(rice._id), 8);

    // The old error paths are unchanged.
    assert.equal((await as(shop).post("/order/create-order", {
        items: [], paymentMethod: "Cash"
    })).body.message, "Cart is empty");

    assert.equal((await as(shop).post("/order/create-order", {
        items: [{ productId: rice._id, quantity: 1 }]
    })).body.message, "Payment method is required");

    const tooMany = await as(shop).post("/order/create-order", {
        items: [{ productId: rice._id, quantity: 99 }],
        paymentMethod: "Cash"
    });

    assert.equal(tooMany.status, 400);
    assert.match(tooMany.body.message, /has only 8 /);

    const badId = await as(shop).post("/order/create-order", {
        items: [{ productId: "nope", quantity: 1 }],
        paymentMethod: "Cash"
    });

    assert.equal(badId.status, 400);
    assert.equal(badId.body.message, "Invalid product ID");

    const foreign = await as(shop).post("/order/create-order", {
        items: [{ productId: new mongoose.Types.ObjectId(), quantity: 1 }],
        paymentMethod: "Cash"
    });

    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.message, "Product not found");

    assert.equal(await stockOf(rice._id), 8, "no failed bill may move stock");
});

test("the recent-transactions list labels udhar instead of hiding it", async () => {
    const rice = await createProduct(shop, { productName: "Rice", stock: 50, sellingPrice: 110 });

    await as(shop).post("/udhar/credit", {
        customerId: customer._id,
        items: [{ productId: rice._id, quantity: 2 }]
    });

    await as(shop).post("/udhar/payment", {
        customerId: customer._id, amount: 100, paymentMethod: "Cash"
    });

    // This endpoint has no paymentStatus filter by default, so it is the one
    // place a credit sale shows up in the existing reports. It must appear
    // honestly labelled, and it must not add to any money total — the
    // endpoint returns a list and a page count, never a sum.
    let payload;

    const res = {
        status(code) { this.code = code; return this; },
        json(body) { payload = { code: this.code || 200, body }; return this; }
    };

    await getRecentTransactions(
        { user: { id: shop.userId }, query: {} },
        res
    );

    assert.equal(payload.code, 200);

    const rows = payload.body.transactions;
    const credit = rows.find((row) => String(row.transactionId).startsWith("UDH-"));

    assert.ok(credit, "the credit sale should be listed");
    assert.equal(credit.status, "Pending");
    assert.equal(credit.type, "Credit");
    assert.equal(credit.customerName, "Ramesh Kumar");

    // The repayment is not an order, so it is not in this list at all:
    // the customer's only row here is the credit sale itself.
    assert.equal(rows.filter((row) => row.customerName === "Ramesh Kumar").length, 1);
    assert.equal(rows.filter((row) => row.amount === 100).length, 0);

    // No monetary total is returned by this endpoint for anything to inflate.
    assert.deepEqual(
        Object.keys(payload.body).sort(),
        ["message", "pagination", "transactions"]
    );
});
