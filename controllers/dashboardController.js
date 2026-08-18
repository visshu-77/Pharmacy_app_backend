import mongoose from "mongoose";

import orderModel from "../model/order.js";
import productModel from "../model/product.js";
import supplierModel from "../model/Supplier.js";

export const getDashboardSummary = async (req, res) => {

    try {

        const userId = new mongoose.Types.ObjectId(req.user.id);
        const totalProducts = await productModel.countDocuments({
            userId
        });

        const today = new Date();

        const startOfDay = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate()
        );

        const endOfDay = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate() + 1
        );

        // -------------------------
        // Today's Orders
        // -------------------------

        const todayOrders = await orderModel.find({
            userId,
            paymentStatus: "Paid",
            createdAt: {
                $gte: startOfDay,
                $lt: endOfDay
            }
        });

        const ordersToday = todayOrders.length;

        // -------------------------
        // Today's Revenue
        // -------------------------

        const todaysRevenue = todayOrders.reduce(
            (total, order) =>
                total + Number(order.grandTotal || 0),
            0
        );

        // -------------------------
        // Low Stock
        // -------------------------

        const lowStock = await productModel.countDocuments({
            userId,
            stock: {
                $gt: 0,
                $lt: 50
            }
        });
        // ==========================================
        // MONTHLY REVENUE
        // ==========================================

        const startOfMonth = new Date(
            today.getFullYear(),
            today.getMonth(),
            1
        );

        const startOfNextMonth = new Date(
            today.getFullYear(),
            today.getMonth() + 1,
            1
        );

        const monthlyOrders = await orderModel.find({
            userId,
            paymentStatus: "Paid",
            createdAt: {
                $gte: startOfMonth,
                $lt: startOfNextMonth
            }
        });

        const monthlyRevenue = monthlyOrders.reduce(
            (total, order) =>
                total + Number(order.grandTotal || 0),
            0
        );

        // -------------------------
        // Expiring Soon
        // -------------------------

        const fiveDaysLater = new Date(startOfDay);

        fiveDaysLater.setDate(
            fiveDaysLater.getDate() + 5
        );

        const thirtyDaysLater = new Date(startOfDay);

        thirtyDaysLater.setDate(
            thirtyDaysLater.getDate() + 30
        );

        const expiringSoon = await productModel.countDocuments({
            userId,

            ExpiryDate: {
                $gte: startOfDay,
                $lte: thirtyDaysLater
            }
        });

        const totalSuppliers = await supplierModel.countDocuments({
            userId
        });

        return res.status(200).json({

            message: "Dashboard summary fetched successfully",

            summary: {
                todaysRevenue,
                ordersToday,
                lowStock,
                expiringSoon,
                totalProducts,
                totalSuppliers,
                monthlyRevenue
            }

        });

    } catch (error) {

        console.log(
            "Dashboard summary error:",
            error
        );

        return res.status(500).json({
            message: "Server Error"
        });

    }
};