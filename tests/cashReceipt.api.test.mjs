import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import mongoose from "mongoose";

import cashReceiptModel from "../model/cashReceipt.js";
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
    await connectTestDb("storeflow_test_cash_receipts_api");
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

beforeEach(async () => {
    await cashReceiptModel.deleteMany({});
});

const asShop = (token) => ({
    post: (path, body) => api.request("POST", path, { token, body }),
    get: (path) => api.request("GET", path, { token })
});

test("cash receipt history and creation require authentication", async () => {
    const list = await api.request("GET", "/cash-receipts");
    const create = await api.request("POST", "/cash-receipts", { body: { recipient: "Ravi", amount: 10 } });

    assert.equal(list.status, 401);
    assert.equal(create.status, 401);
});

test("cash receipts validate the name and amount", async () => {
    const owner = asShop(shop.token);

    const noName = await owner.post("/cash-receipts", { totalAmount: 10, cashReceived: 10 });
    const noAmount = await owner.post("/cash-receipts", {
        recipient: "Ravi",
        totalAmount: 10,
        cashReceived: 0
    });
    const overpaid = await owner.post("/cash-receipts", {
        recipient: "Ravi",
        totalAmount: 10,
        cashReceived: 11
    });

    assert.equal(noName.status, 400);
    assert.equal(noAmount.status, 400);
    assert.equal(overpaid.status, 400);
    assert.equal(await cashReceiptModel.countDocuments({}), 0);
});

test("cash receipts are stored for the signed-in shop and paginated privately", async () => {
    const owner = asShop(shop.token);
    const created = await owner.post("/cash-receipts", {
        recipient: "  Ravi Kumar ",
        totalAmount: 200,
        cashReceived: 125.678,
        userId: otherShop.userId
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.receipt.recipient, "Ravi Kumar");
    assert.equal(created.body.receipt.totalAmount, 200);
    assert.equal(created.body.receipt.cashReceived, 125.68);
    assert.equal(created.body.receipt.remainingAmount, 74.32);
    assert.match(created.body.receipt.receiptNumber, /^CR-/);
    assert.equal(String(created.body.receipt.userId), shop.userId);

    await owner.post("/cash-receipts", { recipient: "Sita", totalAmount: 25, cashReceived: 25 });
    await asShop(otherShop.token).post("/cash-receipts", {
        recipient: "Other",
        totalAmount: 50,
        cashReceived: 50
    });

    const firstShopHistory = await owner.get("/cash-receipts?page=1&limit=1");
    const secondShopPage = await owner.get("/cash-receipts?page=2&limit=1");
    const otherShopHistory = await asShop(otherShop.token).get("/cash-receipts");

    assert.equal(firstShopHistory.body.receipts.length, 1);
    assert.equal(firstShopHistory.body.hasMore, true);
    assert.equal(secondShopPage.body.receipts.length, 1);
    assert.equal(secondShopPage.body.hasMore, false);
    assert.deepEqual(
        [firstShopHistory.body.receipts[0].recipient, secondShopPage.body.receipts[0].recipient].sort(),
        ["Ravi Kumar", "Sita"]
    );
    assert.equal(otherShopHistory.body.receipts.length, 1);
    assert.equal(otherShopHistory.body.receipts[0].recipient, "Other");
});
