import mongoose from "mongoose";
import orderModel from "../model/order.js";
import productModel from "../model/product.js";
import subscriptionModel from "../model/subscription.js";


export const getSalesData = async (userId) => {
    const objectUserId = new mongoose.Types.ObjectId(userId);

    const orders = await orderModel.find({
        userId: objectUserId,
        paymentStatus: "Paid"
    }).lean();

    const totalOrders = orders.length;

    const totalSales = orders.reduce(
        (total, order) => total + (order.grandTotal || 0),
        0
    );

    const productsSold = orders.reduce(
        (total, order) => {
            return total + order.items.reduce(
                (itemTotal, item) =>
                    itemTotal + (item.quantity || 0),
                0
            );
        },
        0
    );

    const averageOrderValue =
        totalOrders > 0
            ? totalSales / totalOrders
            : 0;

    return {
        totalSales,
        totalOrders,
        productsSold,
        averageOrderValue
    };
};

export const getProductData = async (userId) => {

    const products = await productModel.find({
        userId
    }).lean();

    const totalProducts = products.length;

    const lowStockProducts = products.filter(
        product => product.stock > 0 && product.stock <= 5
    );

    const outOfStockProducts = products.filter(
        product => product.stock === 0
    );

    return {
        totalProducts,

        lowStockProducts: lowStockProducts.map(product => ({
            productName: product.productName,
            stock: product.stock,
            sellingPrice: product.sellingPrice
        })),

        outOfStockProducts: outOfStockProducts.map(product => ({
            productName: product.productName,
            stock: product.stock
        }))
    };
};

export const getTopSellingProducts = async (userId) => {

    const objectUserId = new mongoose.Types.ObjectId(userId);

    const products = await orderModel.aggregate([
        {
            $match: {
                userId: objectUserId,
                paymentStatus: "Paid"
            }
        },

        {
            $unwind: "$items"
        },

        {
            $group: {
                _id: "$items.productId",

                productName: {
                    $first: "$items.productName"
                },

                quantitySold: {
                    $sum: "$items.quantity"
                },

                totalSales: {
                    $sum: "$items.total"
                }
            }
        },

        {
            $sort: {
                quantitySold: -1
            }
        },

        {
            $limit: 5
        }
    ]);

    return products.map(product => ({
        productName: product.productName,
        quantitySold: product.quantitySold,
        totalSales: product.totalSales
    }));
};

export const getCategoryPerformance = async (userId) => {

    const objectUserId = new mongoose.Types.ObjectId(userId);

    const categories = await orderModel.aggregate([
        {
            $match: {
                userId: objectUserId,
                paymentStatus: "Paid"
            }
        },

        {
            $unwind: "$items"
        },

        {
            $lookup: {
                from: "dashboard/product",
                localField: "items.productId",
                foreignField: "_id",
                as: "product"
            }
        },

        {
            $unwind: "$product"
        },

        {
            $lookup: {
                from: "/dashaboard/categories",
                localField: "product.productCategory",
                foreignField: "_id",
                as: "category"
            }
        },

        {
            $unwind: "$category"
        },

        {
            $group: {
                _id: "$category._id",

                categoryName: {
                    $first: "$category.categoryName"
                },

                productsSold: {
                    $sum: "$items.quantity"
                },

                totalSales: {
                    $sum: "$items.total"
                }
            }
        },

        {
            $sort: {
                totalSales: -1
            }
        }
    ]);

    return categories.map(category => ({
        categoryName: category.categoryName,
        productsSold: category.productsSold,
        totalSales: category.totalSales
    }));
};

export const getSubscriptionData = async (userId) => {

    const objectUserId = new mongoose.Types.ObjectId(userId);

    const subscriptions = await subscriptionModel
        .find({
            userId: objectUserId,
            paymentStatus: "paid"
        })
        .sort({
            createdAt: -1
        })
        .select(
            "plan duration price paymentMethod paymentStatus subscriptionStatus startDate endDate createdAt razorpayOrderId razorpayPaymentId"
        )
        .lean();

    const now = new Date();

    const currentSubscription = subscriptions.find(
        (subscription) =>
            subscription.subscriptionStatus === "active" &&
            subscription.startDate &&
            subscription.endDate &&
            new Date(subscription.startDate) <= now &&
            new Date(subscription.endDate) > now
    );

    return {
        currentSubscription: currentSubscription || null,
        paymentHistory: subscriptions
    };
};

export const getTransactionData = async (userId) => {

    const objectUserId = new mongoose.Types.ObjectId(userId);

    const orders = await orderModel
        .find({
            userId: objectUserId,
            paymentStatus: "Paid"
        })
        .sort({
            createdAt: -1
        })
        .limit(10)
        .select(
            "invoiceNumber customerName items grandTotal paymentMethod paymentStatus createdAt"
        )
        .lean();


    const subscriptions = await subscriptionModel
        .find({
            userId: objectUserId,
            paymentStatus: "paid"
        })
        .sort({
            createdAt: -1
        })
        .limit(10)
        .select(
            "plan duration price paymentMethod paymentStatus subscriptionStatus createdAt"
        )
        .lean();


    const orderTransactions = orders.map(order => ({
        transactionId: order.invoiceNumber,

        customerName: order.customerName || "-",

        transactionName: order.items
            ?.map(item => item.productName)
            .join(", ") || "-",

        amount: order.grandTotal || 0,

        status: order.paymentStatus,

        date: order.createdAt,

        type: order.paymentMethod
    }));


    const subscriptionTransactions = subscriptions.map(subscription => ({
        transactionId: subscription._id,

        customerName: "Subscription",

        transactionName:
            `${subscription.plan} (${subscription.duration})`,

        amount: subscription.price || 0,

        status: subscription.paymentStatus,

        date: subscription.createdAt,

        type: subscription.paymentMethod
    }));


    const transactions = [
        ...orderTransactions,
        ...subscriptionTransactions
    ];


    transactions.sort(
        (a, b) =>
            new Date(b.date) - new Date(a.date)
    );


    return transactions.slice(0, 10);
};