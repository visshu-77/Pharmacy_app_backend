import mongoose from "mongoose";

import orderModel from "../model/order.js";
import productModel from "../model/product.js";
import supplierModel from "../model/Supplier.js";
import categoryModel from "../model/category.js";
import userModel from "../model/users.js";

import { getBusinessType } from "../config/businessTypes.js";

export const getDashboardSummary = async (req, res) => {

    try {

        const userId = new mongoose.Types.ObjectId(req.user.id);

        const user = await userModel
            .findById(userId)
            .select("businessType preferences Shopname ownerName");

        const profile = getBusinessType(user?.businessType);

        const lowStockThreshold =
            user?.preferences?.lowStockThreshold ?? profile.lowStockThreshold;

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
                $lte: lowStockThreshold
            }
        });

        const outOfStock = await productModel.countDocuments({
            userId,
            stock: { $lte: 0 }
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

        // ==========================================
        // THIS YEAR REVENUE
        // ==========================================

        const startOfYear = new Date(
            today.getFullYear(),
            0,
            1
        );

        const startOfNextYear = new Date(
            today.getFullYear() + 1,
            0,
            1
        );

        const yearlyOrders = await orderModel.find({
            userId,
            paymentStatus: "Paid",
            createdAt: {
                $gte: startOfYear,
                $lt: startOfNextYear
            }
        });

        const yearlyRevenue = yearlyOrders.reduce(
            (total, order) =>
                total + Number(order.grandTotal || 0),
            0
        );

        // ==========================================
        // TOTAL CATEGORIES
        // ==========================================

        const totalCategories = await categoryModel.countDocuments({
            userId
        });

        // -------------------------
        // Expiring Soon
        // -------------------------

        // Only shops that actually track expiry (pharmacy, grocery, bakery,
        // cosmetics) get these counts; for the rest they stay at zero and the
        // UI hides the tiles entirely.
        let expiringSoon = 0;
        let expired = 0;

        if (profile.tracksExpiry) {

            const thirtyDaysLater = new Date(startOfDay);

            thirtyDaysLater.setDate(
                thirtyDaysLater.getDate() + 30
            );

            expiringSoon = await productModel.countDocuments({
                userId,
                ExpiryDate: {
                    $gte: startOfDay,
                    $lte: thirtyDaysLater
                }
            });

            expired = await productModel.countDocuments({
                userId,
                ExpiryDate: {
                    $ne: null,
                    $lt: startOfDay
                }
            });
        }

        const totalSuppliers = await supplierModel.countDocuments({
            userId
        });

        // Stock valuation at cost — what the shelves are worth right now.
        const [valuation] = await productModel.aggregate([
            { $match: { userId } },
            {
                $group: {
                    _id: null,
                    stockValue: {
                        $sum: {
                            $multiply: [
                                { $ifNull: ["$stock", 0] },
                                { $ifNull: ["$purchase", 0] }
                            ]
                        }
                    }
                }
            }
        ]);

        return res.status(200).json({

            message: "Dashboard summary fetched successfully",

            summary: {
                todaysRevenue,
                ordersToday,
                lowStock,
                outOfStock,
                expiringSoon,
                expired,
                totalProducts,
                totalSuppliers,
                monthlyRevenue,
                yearlyRevenue,
                totalCategories,
                stockValue: valuation?.stockValue || 0
            },

            business: {
                type: profile.id,
                label: profile.label,
                shopName: user?.Shopname || "",
                ownerName: user?.ownerName || "",
                tracksExpiry: profile.tracksExpiry,
                lowStockThreshold
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