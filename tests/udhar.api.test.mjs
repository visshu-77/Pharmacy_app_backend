import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";

import mongoose from "mongoose";

import creditCustomerModel from "../model/creditCustomer.js";
import creditTransactionModel from "../model/creditTransaction.js";
import {
    connectTestDb,
    createShop,
    disconnectTestDb,
    startApi
} from "./helpers.mjs";

let api;
let shop;
let otherShop;
let unpaidShop;

before(async () => {
    await connectTestDb("storeflow_test_udhar_api");

    api = await startApi();

    shop = await createShop();
    otherShop = await createShop();
    unpaidShop = await createShop({ withSubscription: false });
});

after(async () => {
    api.close();
    await disconnectTestDb();
});

beforeEach(async () => {
    await creditCustomerModel.deleteMany({});
    await creditTransactionModel.deleteMany({});
});

const asShop = (token) => ({
    post: (path, body) => api.request("POST", path, { token, body }),
    get: (path) => api.request("GET", path, { token }),
    put: (path, body) => api.request("PUT", path, { token, body })
});

/** Save a customer straight to the database, bypassing the API. */
const seedCustomer = (owner, fields) =>
    creditCustomerModel.create({ userId: owner.userId, ...fields });

const seedCharge = (owner, customerId, amount, extra = {}) =>
    creditTransactionModel.create({
        userId: owner.userId,
        customerId,
        createdBy: owner.userId,
        type: "CREDIT_SALE",
        amount,
        ...extra
    });

// ------------------------------------------------------------------- auth

test("every route needs a token", async () => {
    for (const [method, path] of [
        ["POST", "/udhar/customer/create"],
        ["GET", "/udhar/customer/all"],
        ["GET", `/udhar/customer/single/${new mongoose.Types.ObjectId()}`],
        ["PUT", `/udhar/customer/update/${new mongoose.Types.ObjectId()}`]
    ]) {
        const response = await api.request(method, path, {
            ...(method === "GET" ? {} : { body: {} })
        });

        assert.equal(response.status, 401, `${method} ${path}`);
    }
});

test("a rubbish token is rejected", async () => {
    const response = await api.request("GET", "/udhar/customer/all", { token: "not-a-token" });

    assert.equal(response.status, 401);
});

test("a shop without a live plan is blocked, like the rest of the app", async () => {
    const response = await asShop(unpaidShop.token).get("/udhar/customer/all");

    assert.equal(response.status, 403);
    assert.equal(response.body.subscriptionRequired, true);
});

// ----------------------------------------------------------------- create

test("a customer is created under the signed-in shop", async () => {
    const response = await asShop(shop.token).post("/udhar/customer/create", {
        customerName: "  Ramesh Kumar  ",
        phone: "9876543210",
        address: "Near bus stand",
        note: "Pays every Friday"
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.customer.customerName, "Ramesh Kumar");
    assert.equal(response.body.customer.outstanding, 0);
    assert.equal(response.body.customer.isActive, true);

    const saved = await creditCustomerModel.findById(response.body.customer._id);

    assert.equal(String(saved.userId), shop.userId);
});

test("a userId in the body is ignored", async () => {
    const response = await asShop(shop.token).post("/udhar/customer/create", {
        customerName: "Planted",
        userId: otherShop.userId
    });

    assert.equal(response.status, 201);

    const saved = await creditCustomerModel.findById(response.body.customer._id);

    assert.equal(String(saved.userId), shop.userId);
    assert.notEqual(String(saved.userId), otherShop.userId);
});

test("invalid customer details are refused with a readable message", async () => {
    const owner = asShop(shop.token);

    const noName = await owner.post("/udhar/customer/create", { phone: "9876543210" });
    assert.equal(noName.status, 400);
    assert.equal(noName.body.message, "Customer name is required");

    const blankName = await owner.post("/udhar/customer/create", { customerName: "   " });
    assert.equal(blankName.status, 400);

    const badPhone = await owner.post("/udhar/customer/create", {
        customerName: "Short phone",
        phone: "98765"
    });
    assert.equal(badPhone.status, 400);
    assert.match(badPhone.body.message, /10 digits/);

    const longName = await owner.post("/udhar/customer/create", {
        customerName: "x".repeat(81)
    });
    assert.equal(longName.status, 400);

    assert.equal(await creditCustomerModel.countDocuments({}), 0);
});

test("the same phone number cannot be added twice, but another shop may use it", async () => {
    const owner = asShop(shop.token);

    await owner.post("/udhar/customer/create", { customerName: "Ramesh", phone: "9876543210" });

    const again = await owner.post("/udhar/customer/create", {
        customerName: "Ramesh K",
        phone: "9876543210"
    });

    assert.equal(again.status, 409);
    assert.match(again.body.message, /already saved/i);
    assert.ok(again.body.customerId);

    const elsewhere = await asShop(otherShop.token).post("/udhar/customer/create", {
        customerName: "Ramesh",
        phone: "9876543210"
    });

    assert.equal(elsewhere.status, 201);
});

test("a repeated name with no phone is treated as the same person", async () => {
    const owner = asShop(shop.token);

    await owner.post("/udhar/customer/create", { customerName: "Suresh" });

    const again = await owner.post("/udhar/customer/create", { customerName: "  suresh " });

    assert.equal(again.status, 409);
    assert.match(again.body.message, /mobile number to tell them apart/);

    // With a phone they are clearly two different people.
    const distinct = await owner.post("/udhar/customer/create", {
        customerName: "Suresh",
        phone: "9811111111"
    });

    assert.equal(distinct.status, 201);
});

// ------------------------------------------------------------------- list

test("the list pages, searches, filters and totals correctly", async () => {
    const owner = asShop(shop.token);

    const ramesh = await seedCustomer(shop, { customerName: "Ramesh", phone: "9876543210" });
    const suresh = await seedCustomer(shop, { customerName: "Suresh", phone: "9811111111" });
    const mahesh = await seedCustomer(shop, { customerName: "Mahesh" });

    await seedCharge(shop, ramesh._id, 1200);
    await creditTransactionModel.create({
        userId: shop.userId,
        customerId: ramesh._id,
        createdBy: shop.userId,
        type: "PAYMENT",
        amount: 200,
        paymentMethod: "Cash"
    });
    await seedCharge(shop, suresh._id, 300);

    const all = await owner.get("/udhar/customer/all");

    assert.equal(all.status, 200);
    assert.equal(all.body.customers.length, 3);
    assert.deepEqual(all.body.pagination, { page: 1, limit: 20, total: 3, pages: 1 });

    // Highest debt first by default, and a customer with no entries is 0.
    assert.deepEqual(
        all.body.customers.map((row) => [row.customerName, row.outstanding]),
        [["Ramesh", 1000], ["Suresh", 300], ["Mahesh", 0]]
    );

    assert.deepEqual(all.body.totals, {
        customers: 3,
        dueCustomers: 2,
        outstanding: 1300,
        advance: 0
    });

    const byName = await owner.get("/udhar/customer/all?sort=name");
    assert.deepEqual(
        byName.body.customers.map((row) => row.customerName),
        ["Mahesh", "Ramesh", "Suresh"]
    );

    const due = await owner.get("/udhar/customer/all?filter=due");
    assert.equal(due.body.customers.length, 2);
    assert.equal(due.body.pagination.total, 2);

    const clear = await owner.get("/udhar/customer/all?filter=clear");
    assert.deepEqual(clear.body.customers.map((row) => row.customerName), ["Mahesh"]);

    const paged = await owner.get("/udhar/customer/all?limit=2&page=2");
    assert.equal(paged.body.customers.length, 1);
    assert.deepEqual(paged.body.pagination, { page: 2, limit: 2, total: 3, pages: 2 });

    const searched = await owner.get("/udhar/customer/all?search=ahe");
    assert.deepEqual(searched.body.customers.map((row) => row.customerName), ["Mahesh"]);

    const byPhone = await owner.get("/udhar/customer/all?search=9811");
    assert.deepEqual(byPhone.body.customers.map((row) => row.customerName), ["Suresh"]);

    // A search term is text, not a pattern.
    const regexish = await owner.get("/udhar/customer/all?search=.*");
    assert.equal(regexish.body.customers.length, 0);

    assert.equal(mahesh.isActive, true);
});

test("the list only ever shows your own customers", async () => {
    await seedCustomer(shop, { customerName: "Mine" });
    await seedCustomer(otherShop, { customerName: "Theirs" });

    const mine = await asShop(shop.token).get("/udhar/customer/all");
    const theirs = await asShop(otherShop.token).get("/udhar/customer/all");

    assert.deepEqual(mine.body.customers.map((row) => row.customerName), ["Mine"]);
    assert.deepEqual(theirs.body.customers.map((row) => row.customerName), ["Theirs"]);
});

// ----------------------------------------------------------------- single

test("one customer comes back with balance and recent entries", async () => {
    const customer = await seedCustomer(shop, { customerName: "Ramesh", phone: "9876543210" });

    await seedCharge(shop, customer._id, 500, { description: "Groceries" });
    await creditTransactionModel.create({
        userId: shop.userId,
        customerId: customer._id,
        createdBy: shop.userId,
        type: "PAYMENT",
        amount: 150.75,
        paymentMethod: "UPI"
    });

    const response = await asShop(shop.token).get(`/udhar/customer/single/${customer._id}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.customer.customerName, "Ramesh");
    assert.equal(response.body.customer.outstanding, 349.25);
    assert.equal(response.body.customer.charged, 500);
    assert.equal(response.body.customer.paid, 150.75);
    assert.equal(response.body.recentTransactions.length, 2);
});

test("a bad or unknown id is refused", async () => {
    const owner = asShop(shop.token);

    const invalid = await owner.get("/udhar/customer/single/not-an-id");
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.message, "Invalid customer id");

    const missing = await owner.get(`/udhar/customer/single/${new mongoose.Types.ObjectId()}`);
    assert.equal(missing.status, 404);
});

test("another shop's customer is not found, not forbidden", async () => {
    const theirs = await seedCustomer(otherShop, { customerName: "Theirs", phone: "9822222222" });

    const response = await asShop(shop.token).get(`/udhar/customer/single/${theirs._id}`);

    assert.equal(response.status, 404);
    assert.equal(response.body.message, "Customer not found");
    assert.equal(JSON.stringify(response.body).includes("Theirs"), false);
});

// ----------------------------------------------------------------- update

test("a customer's details can be changed, one field at a time", async () => {
    const customer = await seedCustomer(shop, {
        customerName: "Ramesh",
        phone: "9876543210",
        address: "Near bus stand"
    });

    await seedCharge(shop, customer._id, 400);

    const response = await asShop(shop.token).put(
        `/udhar/customer/update/${customer._id}`,
        { customerName: "Ramesh Kumar", note: "Shop owner's cousin" }
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.customer.customerName, "Ramesh Kumar");
    assert.equal(response.body.customer.note, "Shop owner's cousin");
    // Untouched fields survive, and the balance comes along.
    assert.equal(response.body.customer.address, "Near bus stand");
    assert.equal(response.body.customer.phone, "9876543210");
    assert.equal(response.body.customer.outstanding, 400);
});

test("a customer can be deactivated but not corrupted", async () => {
    const customer = await seedCustomer(shop, { customerName: "Gone away" });
    const owner = asShop(shop.token);

    const deactivated = await owner.put(`/udhar/customer/update/${customer._id}`, {
        isActive: false
    });

    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.customer.isActive, false);

    const nonsense = await owner.put(`/udhar/customer/update/${customer._id}`, {
        isActive: "no"
    });

    assert.equal(nonsense.status, 400);

    const emptied = await owner.put(`/udhar/customer/update/${customer._id}`, {
        customerName: ""
    });

    assert.equal(emptied.status, 400);
    assert.equal(
        (await creditCustomerModel.findById(customer._id)).customerName,
        "Gone away"
    );
});

test("an update cannot take a phone number another customer already has", async () => {
    await seedCustomer(shop, { customerName: "Ramesh", phone: "9876543210" });
    const suresh = await seedCustomer(shop, { customerName: "Suresh", phone: "9811111111" });

    const response = await asShop(shop.token).put(
        `/udhar/customer/update/${suresh._id}`,
        { phone: "9876543210" }
    );

    assert.equal(response.status, 409);

    // Keeping its own number is of course fine.
    const unchanged = await asShop(shop.token).put(
        `/udhar/customer/update/${suresh._id}`,
        { phone: "9811111111", customerName: "Suresh Patel" }
    );

    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.body.customer.customerName, "Suresh Patel");
});

test("another shop's customer cannot be updated", async () => {
    const theirs = await seedCustomer(otherShop, { customerName: "Theirs" });

    const response = await asShop(shop.token).put(
        `/udhar/customer/update/${theirs._id}`,
        { customerName: "Hijacked" }
    );

    assert.equal(response.status, 404);

    assert.equal(
        (await creditCustomerModel.findById(theirs._id)).customerName,
        "Theirs"
    );
});

test("an update with a bad id is refused", async () => {
    const response = await asShop(shop.token).put("/udhar/customer/update/123", {
        customerName: "Nope"
    });

    assert.equal(response.status, 400);
});
