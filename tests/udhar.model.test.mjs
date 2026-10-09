import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";

import mongoose from "mongoose";

import creditCustomerModel from "../model/creditCustomer.js";
import creditTransactionModel from "../model/creditTransaction.js";
import { getCustomerTotals } from "../services/creditService.js";
import {
    connectTestDb,
    createShop,
    disconnectTestDb,
    isDuplicateKeyError
} from "./helpers.mjs";

let shop;
let otherShop;
let customer;

before(async () => {
    await connectTestDb("storeflow_test_udhar_model");

    shop = await createShop();
    otherShop = await createShop();
});

after(disconnectTestDb);

beforeEach(async () => {
    await creditCustomerModel.deleteMany({});
    await creditTransactionModel.deleteMany({});

    customer = await creditCustomerModel.create({
        userId: shop.userId,
        customerName: "Ramesh Kumar",
        phone: "9876543210"
    });
});

/** A valid charge, which individual tests override one field at a time. */
const charge = (extra = {}) => ({
    userId: shop.userId,
    customerId: customer._id,
    createdBy: shop.userId,
    type: "CREDIT_SALE",
    amount: 250,
    ...extra
});

// ---------------------------------------------------------------- customer

test("customer requires a name and an owner", async () => {
    await assert.rejects(
        creditCustomerModel.create({ userId: shop.userId }),
        (error) => error.errors?.customerName?.kind === "required"
    );

    await assert.rejects(
        creditCustomerModel.create({ customerName: "No owner" }),
        (error) => error.errors?.userId?.kind === "required"
    );
});

test("customer phone must be blank or exactly 10 digits", async () => {
    await assert.rejects(
        creditCustomerModel.create({
            userId: shop.userId,
            customerName: "Short phone",
            phone: "98765"
        }),
        (error) => error.errors?.phone?.message === "Mobile number should be 10 digits"
    );

    const blank = await creditCustomerModel.create({
        userId: shop.userId,
        customerName: "No phone"
    });

    assert.equal(blank.phone, "");
});

test("customer name is trimmed and length-capped", async () => {
    const saved = await creditCustomerModel.create({
        userId: shop.userId,
        customerName: "   Suresh   "
    });

    assert.equal(saved.customerName, "Suresh");

    await assert.rejects(
        creditCustomerModel.create({
            userId: shop.userId,
            customerName: "x".repeat(81)
        }),
        (error) => error.errors?.customerName?.message === "Customer name is too long"
    );
});

test("one phone number can be saved only once per shop, but is free in another shop", async () => {
    await assert.rejects(
        creditCustomerModel.create({
            userId: shop.userId,
            customerName: "Same number",
            phone: "9876543210"
        }),
        isDuplicateKeyError
    );

    // Two customers of one shop may both have no phone.
    await creditCustomerModel.create({ userId: shop.userId, customerName: "A", phone: "" });
    await creditCustomerModel.create({ userId: shop.userId, customerName: "B", phone: "" });

    // The same person can be in two different shops' khatas.
    const elsewhere = await creditCustomerModel.create({
        userId: otherShop.userId,
        customerName: "Ramesh Kumar",
        phone: "9876543210"
    });

    assert.equal(elsewhere.phone, "9876543210");
});

// ------------------------------------------------------------- transaction

test("amount must be positive, bounded and in paise", async () => {
    for (const amount of [0, -5, 10.005, Number.NaN, 10000001]) {
        await assert.rejects(
            creditTransactionModel.create(charge({ amount })),
            (error) => Boolean(error.errors?.amount),
            `amount ${amount} should be rejected`
        );
    }

    const saved = await creditTransactionModel.create(charge({ amount: 1999.99 }));
    assert.equal(saved.amount, 1999.99);
});

test("direction is taken from the type, not from the caller", async () => {
    const sale = await creditTransactionModel.create(charge({ direction: "decrease" }));
    assert.equal(sale.direction, "increase");
    assert.equal(sale.signedAmount, 250);

    const payment = await creditTransactionModel.create(charge({
        type: "PAYMENT",
        direction: "increase",
        paymentMethod: "Cash"
    }));

    assert.equal(payment.direction, "decrease");
    assert.equal(payment.signedAmount, -250);
});

test("a payment must say how it was paid", async () => {
    await assert.rejects(
        creditTransactionModel.create(charge({ type: "PAYMENT" })),
        (error) => error.errors?.paymentMethod?.kind === "required"
    );

    await assert.rejects(
        creditTransactionModel.create(charge({ type: "PAYMENT", paymentMethod: "Cheque" })),
        (error) => Boolean(error.errors?.paymentMethod)
    );
});

test("an adjustment needs a direction and a reason", async () => {
    await assert.rejects(
        creditTransactionModel.create(charge({ type: "ADJUSTMENT", direction: "decrease" })),
        (error) => error.errors?.reason?.kind === "required"
    );

    await assert.rejects(
        creditTransactionModel.create(charge({ type: "ADJUSTMENT", reason: "Rounded off" })),
        (error) => error.errors?.direction?.kind === "required"
    );

    const saved = await creditTransactionModel.create(charge({
        type: "ADJUSTMENT",
        direction: "decrease",
        amount: 3,
        reason: "Rounded off"
    }));

    assert.equal(saved.signedAmount, -3);
});

test("items belong only to a credit sale and must add up to the amount", async () => {
    const items = [
        { productName: "Rice 5kg", price: 110, quantity: 2, unit: "kg", total: 220 },
        { productName: "Oil 1L", price: 30, quantity: 1, unit: "litre", total: 30 }
    ];

    await assert.rejects(
        creditTransactionModel.create(charge({ type: "PAYMENT", paymentMethod: "Cash", items })),
        /Only a credit sale can carry items/
    );

    await assert.rejects(
        creditTransactionModel.create(charge({ amount: 500, items, entryMode: "product" })),
        /Amount must equal the items sold, less discount, plus tax/
    );

    // With a bill-level discount and tax the amount is checked against them.
    const discounted = await creditTransactionModel.create(
        charge({ amount: 235, items, entryMode: "product", discount: 25, tax: 10 })
    );

    assert.equal(discounted.amount, 235);

    const saved = await creditTransactionModel.create(
        charge({ amount: 250, items, entryMode: "product" })
    );

    assert.equal(saved.items.length, 2);
    assert.equal(saved.items[0].productName, "Rice 5kg");
});

test("the same submission cannot be saved twice for one shop", async () => {
    await creditTransactionModel.create(charge({ idempotencyKey: "pay-001" }));

    await assert.rejects(
        creditTransactionModel.create(charge({ idempotencyKey: "pay-001" })),
        isDuplicateKeyError
    );

    // Different shop, same key — unrelated submission.
    const otherCustomer = await creditCustomerModel.create({
        userId: otherShop.userId,
        customerName: "Their customer"
    });

    const elsewhere = await creditTransactionModel.create({
        userId: otherShop.userId,
        customerId: otherCustomer._id,
        createdBy: otherShop.userId,
        type: "CREDIT_SALE",
        amount: 50,
        idempotencyKey: "pay-001"
    });

    assert.ok(elsewhere._id);

    // Rows without a key are never treated as duplicates of one another.
    await creditTransactionModel.create(charge());
    await creditTransactionModel.create(charge());
});

test("a transaction can be reversed only once", async () => {
    const original = await creditTransactionModel.create(charge());

    await creditTransactionModel.create(charge({
        type: "ADJUSTMENT",
        direction: "decrease",
        reason: "Entered by mistake",
        reversalOf: original._id
    }));

    await assert.rejects(
        creditTransactionModel.create(charge({
            type: "ADJUSTMENT",
            direction: "decrease",
            reason: "Reversed again",
            reversalOf: original._id
        })),
        isDuplicateKeyError
    );
});

// ----------------------------------------------------------- balance maths

test("outstanding is charges minus repayments, including partial ones", async () => {
    await creditTransactionModel.create(charge({ amount: 1200 }));
    await creditTransactionModel.create(charge({ amount: 300.5 }));
    await creditTransactionModel.create(charge({
        type: "PAYMENT",
        amount: 500,
        paymentMethod: "Cash"
    }));
    await creditTransactionModel.create(charge({
        type: "PAYMENT",
        amount: 0.5,
        paymentMethod: "UPI"
    }));
    await creditTransactionModel.create(charge({
        type: "ADJUSTMENT",
        direction: "decrease",
        amount: 1200,
        reason: "Wrote off"
    }));

    const totals = await getCustomerTotals(shop.userId, customer._id);

    assert.deepEqual(
        { charged: totals.charged, paid: totals.paid, outstanding: totals.outstanding },
        { charged: 1500.5, paid: 1700.5, outstanding: -200 }
    );

    assert.equal(totals.entryCount, 5);
});

test("a reversal pair nets to zero and both rows stay in the history", async () => {
    const original = await creditTransactionModel.create(charge({ amount: 999 }));

    await creditTransactionModel.create(charge({
        type: "ADJUSTMENT",
        direction: "decrease",
        amount: 999,
        reason: "Wrong customer",
        reversalOf: original._id
    }));

    const totals = await getCustomerTotals(shop.userId, customer._id);

    assert.equal(totals.outstanding, 0);
    assert.equal(totals.entryCount, 2);

    assert.equal(
        await creditTransactionModel.countDocuments({ customerId: customer._id }),
        2
    );
});

test("balances never mix two shops", async () => {
    const theirCustomer = await creditCustomerModel.create({
        userId: otherShop.userId,
        customerName: "Their customer"
    });

    await creditTransactionModel.create(charge({ amount: 700 }));

    await creditTransactionModel.create({
        userId: otherShop.userId,
        customerId: theirCustomer._id,
        createdBy: otherShop.userId,
        type: "CREDIT_SALE",
        amount: 5000
    });

    assert.equal((await getCustomerTotals(shop.userId, customer._id)).outstanding, 700);
    assert.equal((await getCustomerTotals(otherShop.userId, theirCustomer._id)).outstanding, 5000);

    // Asking for another shop's customer with your own id yields nothing.
    assert.equal((await getCustomerTotals(shop.userId, theirCustomer._id)).outstanding, 0);
});

test("the models are registered under the project's namespaced names", () => {
    assert.ok(mongoose.models["dashboard/creditCustomers"]);
    assert.ok(mongoose.models["dashboard/creditTransactions"]);
});
