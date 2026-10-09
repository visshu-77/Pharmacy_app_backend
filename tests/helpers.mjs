import { once } from "node:events";

import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import productModel from "../model/product.js";
import categoryModel from "../model/category.js";
import userModel from "../model/users.js";
import subscriptionModel from "../model/subscription.js";
import creditCustomerModel from "../model/creditCustomer.js";
import creditTransactionModel from "../model/creditTransaction.js";
import creditRoutes from "../routes/creditRoute.js";
import orderRoutes from "../routes/orderRoute.js";
import noteRoutes from "../routes/noteRoute.js";

/**
 * Shared setup for the udhar tests.
 *
 * They run against a real MongoDB, because the things worth testing here —
 * partial unique indexes, aggregation maths — are the database's behaviour,
 * not Mongoose's. Point TEST_MONGO_HOST at any throwaway server:
 *
 *   npm test                                      # local mongod on 27017
 *   TEST_MONGO_HOST=mongodb://127.0.0.1:27999 npm test   # anywhere else
 *
 * Only the two "storeflow_test_*" databases are touched, and each run drops
 * and rebuilds its own; nothing else on the server is read or changed.
 */

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || "test-secret";

const HOST = process.env.TEST_MONGO_HOST || "mongodb://127.0.0.1:27017";

export const connectTestDb = async (dbName) => {
    await mongoose.connect(`${HOST}/${dbName}`);
    await mongoose.connection.dropDatabase();

    // Partial unique indexes are the point of several tests, so build them
    // before anything runs instead of waiting for the background job.
    await creditCustomerModel.syncIndexes();
    await creditTransactionModel.syncIndexes();
};

/**
 * Does this server do transactions? Only a replica set or a sharded cluster
 * can; a plain mongod cannot, and the code falls back to compensating writes.
 */
export const supportsTransactions = async () => {
    const info = await mongoose.connection.db.admin().command({ hello: 1 });

    return Boolean(info.setName || info.msg === "isdbgrid");
};

/** A product in one shop's inventory. */
export const createProduct = async (owner, fields = {}) => {
    const category = await categoryModel.findOneAndUpdate(
        { userId: owner.userId, categoryName: fields.categoryName || "General" },
        { $setOnInsert: { userId: owner.userId, categoryName: fields.categoryName || "General" } },
        { new: true, upsert: true }
    );

    return productModel.create({
        userId: owner.userId,
        productCategory: category._id,
        productName: fields.productName || "Test item",
        stock: fields.stock ?? 10,
        sellingPrice: fields.sellingPrice ?? 100,
        purchase: fields.purchase ?? 70,
        unit: fields.unit || "piece",
        ...fields
    });
};

export const stockOf = async (productId) =>
    (await productModel.findById(productId).select("stock")).stock;

export const disconnectTestDb = async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
};

let shopCount = 0;

/** A registered shop owner with a token, and by default a live plan. */
export const createShop = async ({ withSubscription = true } = {}) => {
    shopCount += 1;

    const user = await userModel.create({
        Shopname: `Test Shop ${shopCount}`,
        ownerName: `Owner ${shopCount}`,
        mobileNumber: 9000000000 + shopCount,
        email: `shop${shopCount}@test.com`,
        Password: "hashed-password",
        shopAddress: "12 Main Road",
        city: "Indore",
        state: "MP"
    });

    if (withSubscription) {
        const now = Date.now();

        await subscriptionModel.create({
            userId: user._id,
            plan: "pro",
            duration: "monthly",
            price: 499,
            paymentMethod: "razorpay",
            paymentStatus: "paid",
            subscriptionStatus: "active",
            startDate: new Date(now - 86400000),
            endDate: new Date(now + 29 * 86400000)
        });
    }

    const token = jwt.sign(
        { id: user._id, email: user.email, role: user.role },
        process.env.JWT_SECRET_KEY,
        { expiresIn: "1d" }
    );

    return { user, token, userId: String(user._id) };
};

/** The real router, behind the real auth and subscription middleware. */
export const startApi = async () => {
    const app = express();

    app.use(express.json());
    app.use("/udhar", creditRoutes);
    // Mounted so the billing and sales-note paths can be checked for
    // regressions alongside the khata.
    app.use("/order", orderRoutes);
    app.use("/note", noteRoutes);

    const server = app.listen(0);
    await once(server, "listening");

    const { port } = server.address();

    const request = async (method, path, { token, body } = {}) => {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });

        const payload = await response.json().catch(() => null);

        return { status: response.status, body: payload };
    };

    /** Same, but keeps the raw body and headers — for CSV downloads. */
    const requestRaw = async (method, path, { token } = {}) => {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });

        return {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            text: await response.text()
        };
    };

    return { server, request, requestRaw, close: () => server.close() };
};

/** Did this save fail because a unique index rejected it? */
export const isDuplicateKeyError = (error) => error?.code === 11000;
