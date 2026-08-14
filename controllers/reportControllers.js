import mongoose from "mongoose";
import orderModel from "../model/order.js";
import subscriptionModel from "../model/subscription.js";
import userModel from "../model/users.js";
import { Parser } from "json2csv";

const getDateRange = (range) => {
    const now = new Date();
    let startDate;
    let endDate = new Date(now);

    switch (range) {
        case "thisMonth":
            startDate = new Date(
                now.getFullYear(),
                now.getMonth(),
                1
            );
            break;

        case "lastMonth":
            startDate = new Date(
                now.getFullYear(),
                now.getMonth() - 1,
                1
            );
            endDate = new Date(
                now.getFullYear(),
                now.getMonth(),
                1
            );
            break;

        case "last3Months":
            startDate = new Date(
                now.getFullYear(),
                now.getMonth() - 2,
                1
            );
            break;

        case "thisYear":
            startDate = new Date(
                now.getFullYear(),
                0,
                1
            );
            break;

        case "allTime":
        default:
            startDate = null;
            endDate = null;
            break;
    }
    return {
        startDate,
        endDate
    };
};

export const getReportSummary = async (req, res) => {

    try {

        const userId = req.user.id;

        const range = req.query.range || "thisMonth";

        const { startDate, endDate } =
            getDateRange(range);

        const query = {
            userId,
            paymentStatus: "Paid"
        };

        // Add date filter only when required
        if (startDate && endDate) {

            query.createdAt = {
                $gte: startDate,
                $lt: endDate
            };

        } else if (startDate) {

            query.createdAt = {
                $gte: startDate
            };

        }

        const orders = await orderModel.find(query);

        const totalOrders = orders.length;

        const totalSales = orders.reduce(
            (total, order) =>
                total + (order.grandTotal || 0),
            0
        );

        const productsSold = orders.reduce(
            (total, order) => {

                const quantity = order.items.reduce(
                    (itemTotal, item) =>
                        itemTotal + (item.quantity || 0),
                    0
                );

                return total + quantity;
            },
            0
        );

        const averageOrderValue =
            totalOrders > 0
                ? totalSales / totalOrders
                : 0;

        return res.status(200).json({
            range,
            totalSales,
            totalOrders,
            averageOrderValue,
            productsSold
        });

    } catch (error) {

        console.log(
            "Report summary error:",
            error
        );

        return res.status(500).json({
            message: "Server Error"
        });
    }
};

export const getSalesOverview = async (req, res) => {
    try {

        const userId = new mongoose.Types.ObjectId(req.user.id);

        const sales = await orderModel.aggregate([
            {
                $match: {
                    userId: userId,
                    paymentStatus: "Paid"
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: "%Y-%m-%d",
                            date: "$createdAt"
                        }
                    },

                    totalSales: {
                        $sum: "$grandTotal"
                    },

                    totalOrders: {
                        $sum: 1
                    }
                }
            },

            {
                $sort: {
                    "_id": 1
                }
            }
        ]);

        console.log("User ID:", userId);
        console.log("Sales:", sales);

        return res.status(200).json({
            sales
        });

    } catch (error) {

        console.log("Sales overview error:", error);

        return res.status(500).json({
            message: "Server Error"
        });
    }
};

// export const getTopSellingProducts = async (req, res) => {
//     try {
//         const userId = new mongoose.Types.ObjectId(req.user.id);

//         const products = await orderModel.aggregate([
//             {
//                 $match: {
//                     userId: userId,
//                     paymentStatus: "Paid"
//                 }
//             },

//             {
//                 $unwind: "$items"
//             },

//             {
//                 $group: {
//                     _id: "$items.productId",

//                     productName: {
//                         $first: "$items.productName"
//                     },

//                     quantitySold: {
//                         $sum: "$items.quantity"
//                     },

//                     totalSales: {
//                         $sum: "$items.total"
//                     }
//                 }
//             },

//             {
//                 $sort: {
//                     quantitySold: -1
//                 }
//             },

//             {
//                 $limit: 5
//             }
//         ]);

//         return res.status(200).json({
//             products
//         });

//     } catch (error) {
//         console.log("Top selling products error:", error);

//         return res.status(500).json({
//             message: "Server Error"
//         });
//     }
// };

export const getTopSellingProducts = async (req, res) => {
    try {

        const userId = new mongoose.Types.ObjectId(req.user.id);

        const sortBy = req.query.sortBy || "quantity";

        const sortField =
            sortBy === "price"
                ? "totalSales"
                : "quantitySold";

        const products = await orderModel.aggregate([

            {
                $match: {
                    userId: userId,
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
                    [sortField]: -1
                }
            },

            {
                $limit: 5
            }

        ]);

        return res.status(200).json({
            products
        });

    } catch (error) {

        console.log(
            "Top selling products error:",
            error
        );

        return res.status(500).json({
            message: "Server Error"
        });
    }
};

export const getCategoryPerformance = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);

        const categories = await orderModel.aggregate([

            {
                $match: {
                    userId: userId,
                    paymentStatus: "Paid"
                }
            },
            {
                $unwind: "$items"
            },
            {
                $lookup: {
                    from: "dashboard/products",
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

            // 8. Highest sales first
            {
                $sort: {
                    totalSales: -1
                }
            }

        ]);

        return res.status(200).json({
            categories
        });

    } catch (error) {

        console.log(
            "Category performance error:",
            error
        );

        return res.status(500).json({
            message: "Server Error"
        });
    }
};

export const getRecentTransactions = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);

        const {
            customerName = "",
            productName = "",
            amount = "",
            status = "all",
            date = "",
            type = "all"
        } = req.query;

        const page = Math.max(Number(req.query.page) || 1, 1);
        const limit = Math.max(Number(req.query.limit) || 10, 1);

        const skip = (page - 1) * limit;
        console.log("Transaction filters:", req.query);

        // =====================================================
        // ORDERS
        // =====================================================

        const orderQuery = {
            userId
        };

        // Customer
        if (customerName.trim()) {
            orderQuery.customerName = {
                $regex: customerName.trim(),
                $options: "i"
            };
        }

        // Product
        if (productName.trim()) {
            orderQuery["items.productName"] = {
                $regex: productName.trim(),
                $options: "i"
            };
        }

        // Status
        if (status !== "all") {
            orderQuery.paymentStatus = {
                $regex: `^${status.trim()}$`,
                $options: "i"
            };
        }

        // Amount
        if (amount) {
            const numericAmount = Number(amount);

            if (!isNaN(numericAmount)) {
                orderQuery.grandTotal = numericAmount;
            }
        }

        // Payment Type
        if (type !== "all") {
            orderQuery.paymentMethod = {
                $regex: `^${type.trim()}$`,
                $options: "i"
            };
        }

        // Date
        if (date) {
            const startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);

            const endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);

            orderQuery.createdAt = {
                $gte: startDate,
                $lte: endDate
            };
        }

        console.log("Order query:", orderQuery);

        const orders = await orderModel
            .find(orderQuery)
            .sort({ createdAt: -1 });


        // =====================================================
        // SUBSCRIPTIONS
        // =====================================================

        const subscriptionQuery = {
            userId
        };

        // Status
        if (status !== "all") {
            subscriptionQuery.paymentStatus = {
                $regex: `^${status.trim()}$`,
                $options: "i"
            };
        }

        // Amount
        if (amount) {
            const numericAmount = Number(amount);

            if (!isNaN(numericAmount)) {
                subscriptionQuery.price = numericAmount;
            }
        }

        // Payment type
        if (type !== "all") {
            subscriptionQuery.paymentMethod = {
                $regex: `^${type.trim()}$`,
                $options: "i"
            };
        }

        // Date
        if (date) {
            const startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);

            const endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);

            subscriptionQuery.createdAt = {
                $gte: startDate,
                $lte: endDate
            };
        }

        /*
         * If customerName or productName is being searched,
         * subscriptions don't match those fields.
         */

        let subscriptions = [];

        if (!customerName.trim() && !productName.trim()) {
            subscriptions = await subscriptionModel
                .find(subscriptionQuery)
                .sort({ createdAt: -1 });
        }


        // =====================================================
        // FORMAT ORDERS
        // =====================================================

        const orderTransactions = orders.map(order => ({
            transactionId: order.invoiceNumber,

            customerName:
                order.customerName || "Walk-in Customer",

            transactionName: order.items
                .map(item => item.productName)
                .join(", "),

            amount: order.grandTotal,

            status: order.paymentStatus,

            date: order.createdAt,

            type: order.paymentMethod,

            transactionType: "order"
        }));


        // =====================================================
        // FORMAT SUBSCRIPTIONS
        // =====================================================

        const subscriptionTransactions = subscriptions.map(
            subscription => ({
                transactionId:
                    subscription.razorpayPaymentId ||
                    subscription.razorpayOrderId ||
                    subscription._id,

                customerName: "Subscription",

                transactionName:
                    `${subscription.plan} - ${subscription.duration}`,

                amount: subscription.price,

                status: subscription.paymentStatus,

                date: subscription.createdAt,

                type: subscription.paymentMethod,

                transactionType: "subscription"
            })
        );


        // =====================================================
        // COMBINE
        // =====================================================

        const transactions = [
            ...orderTransactions,
            ...subscriptionTransactions
        ];


        // Latest first
        transactions.sort(
            (a, b) =>
                new Date(b.date) - new Date(a.date)
        );

        const totalTransactions = transactions.length;

        const totalPages = Math.ceil(totalTransactions / limit);

        const paginatedTransactions = transactions.slice(
            skip,
            skip + limit
        );


        return res.status(200).json({
            message: "Recent transactions fetched successfully",
            transactions: paginatedTransactions,

            pagination: {
                currentPage: page,
                limit,
                totalTransactions,
                totalPages
            }
        });

    } catch (error) {

        console.log(
            "Recent transactions error:",
            error
        );

        return res.status(500).json({
            message: "Server Error"
        });
    }
};

export const exportReport = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);

        const orders = await orderModel
            .find({
                userId
            })
            .sort({ createdAt: -1 })
            .lean();

        const reportData = [];

        orders.forEach((order) => {

            order.items.forEach((item) => {

                reportData.push({
                    transactionId: order.invoiceNumber || "",
                    customerName: order.customerName || "Walk-in Customer",
                    productName: item.productName || "",
                    quantity: item.quantity || 0,
                    amount: item.total || 0,
                    status: order.paymentStatus || "",
                    paymentType: order.paymentMethod || "",
                    date: order.createdAt
                        ? new Date(order.createdAt).toLocaleDateString("en-IN")
                        : ""
                });

            });

        });

        if (reportData.length === 0) {
            return res.status(404).json({
                message: "No report data available"
            });
        }

        const fields = [
            "transactionId",
            "customerName",
            "productName",
            "quantity",
            "amount",
            "status",
            "paymentType",
            "date"
        ];

        const parser = new Parser({
            fields
        });

        const csv = parser.parse(reportData);

        res.header("Content-Type", "text/csv");
        res.attachment("sales-report.csv");

        return res.send(csv);

    } catch (error) {

        console.log("Export report error:", error);

        return res.status(500).json({
            message: "Failed to export report"
        });
    }
};