import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";

import mongoose from "mongoose";

import creditCustomerModel from "../model/creditCustomer.js";
import creditTransactionModel from "../model/creditTransaction.js";
import orderModel from "../model/order.js";
import productModel from "../model/product.js";
import { getSalesData } from "../services/reportDataService.js";
import { MAX_RANGE_DAYS } from "../services/creditService.js";
import {
    connectTestDb,
    createProduct,
    createShop,
    disconnectTestDb,
    startApi,
    stockOf
} from "./helpers.mjs";

/** Phase 4: the overview, statements, exports, filters and reminders. */

let api;
let shop;
let otherShop;
let ramesh;
let sunita;

const day = (iso) => new Date(`${iso}T10:00:00.000Z`);

before(async () => {
    await connectTestDb("storeflow_test_udhar_phase4");

    api = await startApi();

    shop = await createShop();
    otherShop = await createShop();
});

after(async () => {
    api.close();
    await disconnectTestDb();
});

const as = (owner) => ({
    post: (path, body) => api.request("POST", path, { token: owner.token, body }),
    get: (path) => api.request("GET", path, { token: owner.token }),
    raw: (path) => api.requestRaw("GET", path, { token: owner.token })
});

beforeEach(async () => {
    await Promise.all([
        creditCustomerModel.deleteMany({}),
        creditTransactionModel.deleteMany({}),
        orderModel.deleteMany({}),
        productModel.deleteMany({})
    ]);

    ramesh = await creditCustomerModel.create({
        userId: shop.userId, customerName: "Ramesh Kumar", phone: "9876543210"
    });

    sunita = await creditCustomerModel.create({
        userId: shop.userId, customerName: "Sunita Devi", phone: "9811122233"
    });
});

/** A ledger written straight to the database, with dates we control. */
const seedLedger = async () => {
    const rows = [
        { customerId: ramesh._id, type: "CREDIT_SALE", amount: 1000, date: day("2026-01-05") },
        { customerId: ramesh._id, type: "PAYMENT", amount: 400, paymentMethod: "Cash", date: day("2026-01-20") },
        { customerId: ramesh._id, type: "CREDIT_SALE", amount: 250, date: day("2026-02-08") },
        { customerId: ramesh._id, type: "PAYMENT", amount: 100, paymentMethod: "UPI", date: day("2026-02-15") },
        { customerId: ramesh._id, type: "PAYMENT", amount: 50, paymentMethod: "Cash", date: day("2026-02-28") },
        { customerId: sunita._id, type: "CREDIT_SALE", amount: 800, date: day("2026-02-10") }
    ];

    for (const row of rows) {
        await creditTransactionModel.create({
            userId: shop.userId,
            createdBy: shop.userId,
            ...row
        });
    }
};

// ------------------------------------------------------------- 1. overview

test("the overview totals what is owed and what moved in the period", async () => {
    await seedLedger();

    const all = await as(shop).get("/udhar/summary");

    assert.equal(all.status, 200);
    assert.deepEqual(
        {
            outstanding: all.body.summary.outstanding,
            dueCustomers: all.body.summary.dueCustomers,
            customers: all.body.summary.customers,
            creditGiven: all.body.summary.creditGiven,
            paymentsCollected: all.body.summary.paymentsCollected
        },
        // Ramesh 1000 − 400 + 250 − 100 − 50 = 700; Sunita 800.
        { outstanding: 1500, dueCustomers: 2, customers: 2, creditGiven: 2050, paymentsCollected: 550 }
    );

    // February only: one charge of 250, payments of 100 + 50, plus Sunita 800.
    const february = await as(shop).get("/udhar/summary?from=2026-02-01&to=2026-03-01");

    assert.equal(february.body.summary.creditGiven, 1050);
    assert.equal(february.body.summary.paymentsCollected, 150);

    // Outstanding is always "right now", whatever period is asked for.
    assert.equal(february.body.summary.outstanding, 1500);
});

test("the overview names who owes the most, biggest first", async () => {
    await seedLedger();

    const response = await as(shop).get("/udhar/summary");
    const debtors = response.body.topDebtors;

    assert.deepEqual(
        debtors.map((row) => [row.customerName, row.outstanding]),
        [["Sunita Devi", 800], ["Ramesh Kumar", 700]]
    );

    assert.equal(debtors[0].phone, "9811122233");
    assert.ok(debtors[0].lastActivityAt, "carries the last entry date");
});

test("a settled customer is not listed as a debtor", async () => {
    await creditTransactionModel.create({
        userId: shop.userId, createdBy: shop.userId, customerId: ramesh._id,
        type: "CREDIT_SALE", amount: 100, date: day("2026-03-01")
    });
    await creditTransactionModel.create({
        userId: shop.userId, createdBy: shop.userId, customerId: ramesh._id,
        type: "PAYMENT", amount: 100, paymentMethod: "Cash", date: day("2026-03-02")
    });

    const response = await as(shop).get("/udhar/summary");

    assert.deepEqual(response.body.topDebtors, []);
    assert.equal(response.body.summary.dueCustomers, 0);
});

test("recent entries come back newest first, with the customer's name", async () => {
    await seedLedger();

    const response = await as(shop).get("/udhar/summary");
    const recent = response.body.recent;

    assert.equal(recent.length, 6);
    assert.equal(recent[0].amount, 50);
    assert.equal(recent[0].customerName, "Ramesh Kumar");
    assert.equal(recent[0].paymentMethod, "Cash");

    const dates = recent.map((row) => new Date(row.date).getTime());
    assert.deepEqual(dates, [...dates].sort((a, b) => b - a), "newest first");
});

test("the overview only ever counts your own shop", async () => {
    await seedLedger();

    const theirCustomer = await creditCustomerModel.create({
        userId: otherShop.userId, customerName: "Someone else", phone: "9700000000"
    });

    await creditTransactionModel.create({
        userId: otherShop.userId, createdBy: otherShop.userId,
        customerId: theirCustomer._id, type: "CREDIT_SALE", amount: 99999
    });

    const mine = await as(shop).get("/udhar/summary");

    assert.equal(mine.body.summary.outstanding, 1500);
    assert.equal(mine.body.topDebtors.length, 2);
    assert.equal(JSON.stringify(mine.body).includes("Someone else"), false);
    assert.equal(JSON.stringify(mine.body).includes("99999"), false);
});

// ------------------------------------------------- 2. statement boundaries

test("a statement's opening, period and closing figures line up", async () => {
    await seedLedger();

    const february = await as(shop).get(
        `/udhar/transactions?customerId=${ramesh._id}&from=2026-02-01&to=2026-03-01`
    );

    assert.equal(february.body.openingBalance, 600);     // what January left
    assert.equal(february.body.summary.charges, 250);
    assert.equal(february.body.summary.payments, 150);
    assert.equal(february.body.summary.closingBalance, 700);

    // opening + charges − payments = closing
    assert.equal(
        february.body.openingBalance + february.body.summary.charges - february.body.summary.payments,
        february.body.summary.closingBalance
    );
});

test("the range includes its first day and excludes its last", async () => {
    await creditTransactionModel.create({
        userId: shop.userId, createdBy: shop.userId, customerId: ramesh._id,
        type: "CREDIT_SALE", amount: 100, date: new Date("2026-02-01T00:00:00.000Z")
    });

    await creditTransactionModel.create({
        userId: shop.userId, createdBy: shop.userId, customerId: ramesh._id,
        type: "CREDIT_SALE", amount: 200, date: new Date("2026-02-28T23:59:59.000Z")
    });

    await creditTransactionModel.create({
        userId: shop.userId, createdBy: shop.userId, customerId: ramesh._id,
        type: "CREDIT_SALE", amount: 400, date: new Date("2026-03-01T00:00:00.000Z")
    });

    const february = await as(shop).get(
        `/udhar/transactions?customerId=${ramesh._id}&from=2026-02-01&to=2026-03-01`
    );

    assert.deepEqual(
        february.body.transactions.map((row) => row.amount),
        [100, 200],
        "the midnight start is in, the midnight end is out"
    );

    assert.equal(february.body.openingBalance, 0);
    assert.equal(february.body.summary.closingBalance, 700, "closing is always the whole khata");
});

test("a bad date range is refused", async () => {
    const backwards = await as(shop).get(
        `/udhar/transactions?customerId=${ramesh._id}&from=2026-03-01&to=2026-02-01`
    );

    assert.equal(backwards.status, 400);
    assert.match(backwards.body.message, /after the start date/);

    const nonsense = await as(shop).get(
        `/udhar/transactions?customerId=${ramesh._id}&from=not-a-date`
    );

    assert.equal(nonsense.status, 400);

    const tooWide = await as(shop).get(
        `/udhar/transactions?customerId=${ramesh._id}&from=2000-01-01&to=2026-01-01`
    );

    assert.equal(tooWide.status, 400);
    assert.match(tooWide.body.message, /shorter period/);
    assert.ok(MAX_RANGE_DAYS > 0);
});

// ----------------------------------------------------------- 3. filters

test("entries filter by type and by payment method", async () => {
    await seedLedger();

    const payments = await as(shop).get(
        `/udhar/transactions?customerId=${ramesh._id}&type=PAYMENT`
    );

    assert.deepEqual(payments.body.transactions.map((row) => row.amount), [400, 100, 50]);
    assert.equal(payments.body.pagination.total, 3);

    const cash = await as(shop).get(
        `/udhar/transactions?customerId=${ramesh._id}&paymentMethod=Cash`
    );

    assert.deepEqual(cash.body.transactions.map((row) => row.amount), [400, 50]);

    const upiInFebruary = await as(shop).get(
        `/udhar/transactions?customerId=${ramesh._id}&paymentMethod=UPI&from=2026-02-01&to=2026-03-01`
    );

    assert.deepEqual(upiInFebruary.body.transactions.map((row) => row.amount), [100]);

    // An unknown method is ignored rather than returning nothing.
    const bogus = await as(shop).get(
        `/udhar/transactions?customerId=${ramesh._id}&paymentMethod=Cheque`
    );

    assert.equal(bogus.body.pagination.total, 5);
});

test("the closing balance ignores the filter, as a khata should", async () => {
    await seedLedger();

    const payments = await as(shop).get(
        `/udhar/transactions?customerId=${ramesh._id}&type=PAYMENT`
    );

    assert.equal(payments.body.summary.closingBalance, 700);
    assert.equal(payments.body.summary.charges, 0);
    assert.equal(payments.body.summary.payments, 550);
});

test("paging a filtered ledger keeps the running balance continuous", async () => {
    await seedLedger();

    const first = await as(shop).get(`/udhar/transactions?customerId=${ramesh._id}&limit=2&page=1`);
    const second = await as(shop).get(`/udhar/transactions?customerId=${ramesh._id}&limit=2&page=2`);
    const third = await as(shop).get(`/udhar/transactions?customerId=${ramesh._id}&limit=2&page=3`);

    assert.deepEqual(first.body.transactions.map((row) => row.runningBalance), [1000, 600]);
    assert.deepEqual(second.body.transactions.map((row) => row.runningBalance), [850, 750]);
    assert.deepEqual(third.body.transactions.map((row) => row.runningBalance), [700]);
    assert.equal(third.body.pagination.pages, 3);
});

// ------------------------------------------------------------ 4. CSV export

test("the export is the saved ledger, as a CSV", async () => {
    await seedLedger();

    const response = await as(shop).raw(`/udhar/statement/export?customerId=${ramesh._id}`);

    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /text\/csv/);
    assert.match(response.headers["content-disposition"], /udhar-ramesh-kumar-/);
    assert.equal(response.headers["x-statement-rows"], "5");
    assert.equal(response.headers["x-statement-truncated"], "false");
    assert.equal(response.headers["x-statement-closing-balance"], "700");

    const lines = response.text.trim().split("\n");

    assert.match(lines[0], /date.*type.*details.*reference.*paymentMethod.*udhar.*paid.*balance/i);
    assert.equal(lines.length, 7, "a header, an opening row and five entries");
    assert.match(lines[1], /Opening balance/);

    // The running balance in the file matches the statement's.
    assert.match(response.text, /700/);
    assert.match(response.text, /Payment received/);
    assert.match(response.text, /Udhar given/);
});

test("the export honours the date range", async () => {
    await seedLedger();

    const february = await as(shop).raw(
        `/udhar/statement/export?customerId=${ramesh._id}&from=2026-02-01&to=2026-03-01`
    );

    assert.equal(february.status, 200);
    assert.equal(february.headers["x-statement-rows"], "3");

    // Opening balance for the window, not zero.
    assert.match(february.text.split("\n")[1], /600/);

    const empty = await as(shop).raw(
        `/udhar/statement/export?customerId=${ramesh._id}&from=2026-06-01&to=2026-07-01`
    );

    assert.equal(empty.status, 404);
});

test("an export cannot reach another shop's customer", async () => {
    await seedLedger();

    const theirs = await creditCustomerModel.create({
        userId: otherShop.userId, customerName: "Theirs", phone: "9700000001"
    });

    await creditTransactionModel.create({
        userId: otherShop.userId, createdBy: otherShop.userId,
        customerId: theirs._id, type: "CREDIT_SALE", amount: 4242
    });

    const guessed = await as(shop).raw(`/udhar/statement/export?customerId=${theirs._id}`);

    assert.equal(guessed.status, 404);
    assert.equal(guessed.text.includes("4242"), false);

    const invalid = await as(shop).raw("/udhar/statement/export?customerId=nonsense");
    assert.equal(invalid.status, 400);

    const noToken = await api.requestRaw("GET", `/udhar/statement/export?customerId=${ramesh._id}`);
    assert.equal(noToken.status, 401);

    // And the other shop sees only its own.
    const theirExport = await as(otherShop).raw(`/udhar/statement/export?customerId=${theirs._id}`);
    assert.equal(theirExport.status, 200);
    assert.match(theirExport.text, /4242/);
    assert.equal(theirExport.text.includes("Ramesh"), false);
});

test("an export with a silly date range is refused", async () => {
    await seedLedger();

    const tooWide = await as(shop).raw(
        `/udhar/statement/export?customerId=${ramesh._id}&from=2000-01-01&to=2026-01-01`
    );

    assert.equal(tooWide.status, 400);
    assert.match(tooWide.text, /shorter period/);
});

test("a huge ledger is capped and says so", async () => {
    const many = [];

    for (let i = 0; i < 60; i += 1) {
        many.push({
            userId: shop.userId, createdBy: shop.userId, customerId: sunita._id,
            type: "CREDIT_SALE", amount: 10, date: new Date(2026, 0, 1, 0, i)
        });
    }

    await creditTransactionModel.insertMany(many);

    // The cap is 5000 rows in production; this proves the plumbing, using the
    // service directly so the test does not have to write 5000 documents.
    const { getStatementRows } = await import("../services/creditService.js");

    const capped = await getStatementRows({
        userId: shop.userId, customerId: sunita._id, from: null, to: null, limit: 25
    });

    assert.equal(capped.rows.length, 25);
    assert.equal(capped.total, 60);
    assert.equal(capped.truncated, true);
    assert.equal(capped.closingBalance, 600, "the closing balance still covers everything");
});

// ----------------------------------------------------------- 5. reminders

test("a reminder names this customer only, and is never sent", async () => {
    await seedLedger();

    const response = await as(shop).get(`/udhar/customer/${ramesh._id}/reminder`);

    assert.equal(response.status, 200);

    const { text, outstanding, whatsappPhone, customerName } = response.body.reminder;

    assert.equal(outstanding, 700);
    assert.equal(customerName, "Ramesh Kumar");
    assert.equal(whatsappPhone, "919876543210", "10 digits get the country code");

    assert.match(text, /Ramesh Kumar/);
    assert.match(text, /700\.00/);
    assert.match(text, /Test Shop/);          // the shop identifies itself
    assert.match(text, /Last payment received/);

    // Nothing about anybody else's khata.
    assert.equal(text.includes("Sunita"), false);
    assert.equal(text.includes("800"), false);
});

test("there is nothing to remind a settled customer about", async () => {
    const response = await as(shop).get(`/udhar/customer/${ramesh._id}/reminder`);

    assert.equal(response.status, 400);
    assert.match(response.body.message, /nothing outstanding/);
});

test("a reminder cannot be pulled for another shop's customer", async () => {
    const theirs = await creditCustomerModel.create({
        userId: otherShop.userId, customerName: "Theirs", phone: "9700000002"
    });

    await creditTransactionModel.create({
        userId: otherShop.userId, createdBy: otherShop.userId,
        customerId: theirs._id, type: "CREDIT_SALE", amount: 500
    });

    const response = await as(shop).get(`/udhar/customer/${theirs._id}/reminder`);

    assert.equal(response.status, 404);
});

// ------------------------------------------------------- 6. still correct

test("none of this phase leaks udhar into the sales reports", async () => {
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

    const before = await getSalesData(shop.userId);

    const sale = await as(shop).post("/udhar/credit", {
        customerId: ramesh._id,
        items: [{ productId: rice._id, quantity: 3 }]
    });

    assert.equal(sale.status, 201);

    await as(shop).post("/udhar/payment", {
        customerId: ramesh._id, amount: 200, paymentMethod: "Cash"
    });

    // Reading the overview and exporting must not change a thing either.
    await as(shop).get("/udhar/summary");
    await as(shop).raw(`/udhar/statement/export?customerId=${ramesh._id}`);

    const after = await getSalesData(shop.userId);

    assert.deepEqual(after, before, "cash sales figures are untouched");
    assert.equal(await stockOf(rice._id), 47, "the credit sale moved stock exactly once");
    assert.equal(
        await orderModel.countDocuments({ userId: shop.user._id, paymentStatus: "Paid" }),
        1
    );
});
