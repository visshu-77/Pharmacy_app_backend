import mongoose from "mongoose";
import orderModel from "../model/order.js";
import subscriptionModel from "../model/subscription.js";
import userModel from "../model/users.js";

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

export const getTopSellingProducts = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);

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
                    quantitySold: -1
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
        console.log("Top selling products error:", error);

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

// export const getRecentTransactions = async (req, res) => {
//     try {

//         const userId = new mongoose.Types.ObjectId(req.user.id);

//         const {
//             customerName,
//             productName,
//             amount,
//             status,
//             date,
//             type
//         } = req.query;

//         const orderQuery = {
//             userId,
//             paymentStatus: "Paid"
//         };

//         if (customerName) {
//             orderQuery.customerName = {
//                 $regex: customerName,
//                 $options: "i"
//             };
//         }

//         if (amount) {
//             orderQuery.grandTotal = Number(amount);
//         }

//         if (type) {
//             orderQuery.paymentMethod = {
//                 $regex: type,
//                 $options: "i"
//             };
//         }

//         if (date) {

//             const startDate = new Date(date);

//             startDate.setHours(0, 0, 0, 0);

//             const endDate = new Date(startDate);

//             endDate.setDate(endDate.getDate() + 1);

//             orderQuery.createdAt = {
//                 $gte: startDate,
//                 $lt: endDate
//             };
//         }

//         // Get orders
//         const orders = await orderModel.find({
//             userId,
//             paymentStatus: "Paid"
//         }).sort({
//             createdAt: -1
//         });


//         // Get subscriptions
//         const subscriptions = await subscriptionModel.find({
//             userId,
//             paymentStatus: "paid"
//         }).sort({
//             createdAt: -1
//         });


//         // Get user
//         const user = await userModel
//             .findById(userId)
//             .select("ownerName");


//         // Convert orders into common transaction format
//         const orderTransactions = orders.map((order) => {

//             const productNames = order.items
//                 .map((item) => item.productName)
//                 .join(", ");

//             return {
//                 transactionId: order.invoiceNumber,

//                 customerName: order.customerName || "-",

//                 transactionName: productNames || "-",

//                 amount: order.grandTotal || 0,

//                 status: order.paymentStatus,

//                 date: order.createdAt,

//                 type: order.paymentMethod
//             };

//         });


//         // Convert subscriptions into common transaction format
//         const subscriptionTransactions = subscriptions.map(
//             (subscription) => {

//                 return {
//                     transactionId:
//                         subscription.razorpayPaymentId,

//                     customerName:
//                         user?.ownerName || "-",

//                     transactionName:
//                         `${subscription.plan} - ${subscription.duration}`,

//                     amount:
//                         subscription.price || 0,

//                     status:
//                         subscription.paymentStatus,

//                     date:
//                         subscription.createdAt,

//                     type:
//                         subscription.paymentMethod
//                 };

//             }
//         );


//         // Combine both
//         const transactions = [
//             ...orderTransactions,
//             ...subscriptionTransactions
//         ];


//         // Sort newest first
//         transactions.sort(
//             (a, b) =>
//                 new Date(b.date) -
//                 new Date(a.date)
//         );


//         return res.status(200).json({
//             message: "Recent transactions fetched successfully",
//             transactions
//         });


//     } catch (error) {

//         console.log(
//             "Recent transactions error:",
//             error
//         );

//         return res.status(500).json({
//             message: "Server Error"
//         });

//     }
// };



export const getRecentTransactions = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);

        // Filters from frontend
        const {
            customerName = "",
            productName = "",
            amount = "",
            status = "all",
            date = "",
            type = "all"
        } = req.query;

        /*
        |--------------------------------------------------------------------------
        | Get Orders
        |--------------------------------------------------------------------------
        */

        const orderQuery = {
            userId
        };

        // Customer name filter
        if (customerName.trim()) {
            orderQuery.customerName = {
                $regex: customerName.trim(),
                $options: "i"
            };
        }

        // Status filter
        if (status !== "all") {
            orderQuery.paymentStatus = status;
        }

        // Payment type filter
        if (type !== "all" && type !== "Razorpay") {
            orderQuery.paymentMethod = type;
        }

        // Amount filter
        if (amount) {
            const numericAmount = Number(amount);

            if (!isNaN(numericAmount)) {
                orderQuery.grandTotal = numericAmount;
            }
        }

        // Date filter
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

        const orders = await orderModel
            .find(orderQuery)
            .sort({ createdAt: -1 });


        /*
        |--------------------------------------------------------------------------
        | Product Name Filter
        |--------------------------------------------------------------------------
        */

        let filteredOrders = orders;

        if (productName.trim()) {
            const searchProduct = productName.trim().toLowerCase();

            filteredOrders = orders.filter(order =>
                order.items.some(item =>
                    item.productName
                        ?.toLowerCase()
                        .includes(searchProduct)
                )
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Get Subscriptions
        |--------------------------------------------------------------------------
        */

        const subscriptionQuery = {
            userId
        };

        // Status filter for subscription
        if (status !== "all") {
            subscriptionQuery.paymentStatus = status.toLowerCase();
        }

        // Payment type
        if (type !== "all" && type !== "Cash" && type !== "Card" && type !== "UPI") {
            subscriptionQuery.paymentMethod = type;
        }

        // Amount
        if (amount) {
            const numericAmount = Number(amount);

            if (!isNaN(numericAmount)) {
                subscriptionQuery.price = numericAmount;
            }
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

        const subscriptions = await subscriptionModel
            .find(subscriptionQuery)
            .sort({ createdAt: -1 });


        /*
        |--------------------------------------------------------------------------
        | Product Name filter for subscriptions
        |--------------------------------------------------------------------------
        */

        let filteredSubscriptions = subscriptions;

        if (productName.trim()) {
            filteredSubscriptions = [];
        }


        /*
        |--------------------------------------------------------------------------
        | Customer Name filter
        |--------------------------------------------------------------------------
        |
        | Subscription doesn't have customerName.
        | Therefore, if customerName is searched,
        | don't return subscriptions.
        |
        */

        if (customerName.trim()) {
            filteredSubscriptions = [];
        }


        /*
        |--------------------------------------------------------------------------
        | Payment Type Filter
        |--------------------------------------------------------------------------
        */

        let finalOrders = filteredOrders;
        let finalSubscriptions = filteredSubscriptions;

        if (type !== "all") {
            finalOrders = filteredOrders.filter(order =>
                order.paymentMethod === type
            );

            finalSubscriptions = filteredSubscriptions.filter(subscription =>
                subscription.paymentMethod === type
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Combine Transactions
        |--------------------------------------------------------------------------
        */

        const transactions = [
            ...finalOrders.map(order => ({
                transactionId: order.invoiceNumber,

                customerName: order.customerName || "Walk-in Customer",

                productName: order.items
                    .map(item => item.productName)
                    .join(", "),

                amount: order.grandTotal,

                status: order.paymentStatus,

                date: order.createdAt,

                type: order.paymentMethod,

                transactionType: "order"
            })),

            ...finalSubscriptions.map(subscription => ({
                transactionId:
                    subscription.razorpayPaymentId ||
                    subscription.razorpayOrderId ||
                    subscription._id,

                customerName: "Subscription",

                productName: `${subscription.plan} - ${subscription.duration}`,

                amount: subscription.price,

                status: subscription.paymentStatus,

                date: subscription.createdAt,

                type: subscription.paymentMethod,

                transactionType: "subscription"
            }))
        ];


        /*
        |--------------------------------------------------------------------------
        | Sort latest transaction first
        |--------------------------------------------------------------------------
        */

        transactions.sort(
            (a, b) =>
                new Date(b.date) - new Date(a.date)
        );


        return res.status(200).json({
            message: "Recent transactions fetched successfully",
            transactions
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