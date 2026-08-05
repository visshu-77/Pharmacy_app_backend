import subscriptionModel from "../model/subscription.js";
import razorpay from "../config/razorpay.js";
import crypto from "crypto";
import { subscriptionPlans } from "../config/subscriptionPlans.js";

export const createSubscription = async (req, res) => {
    try {
        const {
            plan,
            duration,
            price,
            paymentMethod
        } = req.body;


        if (!plan || !duration || !price) {
            return res.status(400).json({
                message: "Plan, duration and price are required"
            });
        }

        const startDate = new Date();
        const endDate = new Date(startDate);

        if (duration == "monthly") {
            endDate.setMonth(
                endDate.getMonth() + 1
            );
        } else if (duration == 'sixMonths') {
            endDate.setMonth(
                endDate.getMonth() + 6
            );
        } else if (duration == "yearly") {
            endDate.setFullYear(
                endDate.getFullYear() + 1
            );
        }

        const subscription = await subscriptionModel.create({
            userId: req.user.id,
            plan,
            duration,
            price,
            startDate,
            endDate,
            subscriptionStatus: "active",
            paymentStatus: "paid",
            paymentMethod
        })

        return res.status(200).json({
            message: "subscription created successfully",
            subscription
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Server error"
        })
    }
}

export const createPaymentOrder = async (req, res) => {
    try {
        const {
            plan,
            duration
        } = req.body;
        if (!plan || !duration) {
            return res.status(400).json({
                message: "Plan and duration are required"
            });
        }

        const price = subscriptionPlans?.[plan]?.[duration];
        if (!price) {
            return res.status(400).json({
                message: "Invalid plan or duration"
            });
        }
        const razorpayOrder = await razorpay.orders.create({
            amount: price * 100,
            currency: "INR",
            receipt: `sub_${Date.now()}`
        });
        return res.status(201).json({
            message: "Payment order created",
            order: {
                id: razorpayOrder.id,
                amount: razorpayOrder.amount,
                currency: razorpayOrder.currency
            },
            plan,
            duration,
            price
        });
    } catch (error) {
        console.log(
            "Razorpay order error:",
            error
        );
        return res.status(500).json({
            message: "Unable to create payment order"
        });
    }
};

export const verifyPayment = async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            plan,
            duration
        } = req.body;

        // Check required fields
        if (
            !razorpay_order_id ||
            !razorpay_payment_id ||
            !razorpay_signature ||
            !plan ||
            !duration
        ) {
            return res.status(400).json({
                message: "Payment verification data is missing"
            });
        }

        // Create the signature
        const body =
            razorpay_order_id +
            "|" +
            razorpay_payment_id;

        const expectedSignature = crypto
            .createHmac(
                "sha256",
                process.env.RAZORPAY_KEY_SECRET
            )
            .update(body)
            .digest("hex");

        // Compare Razorpay signature
        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({
                message: "Payment verification failed"
            });
        }


        const price = subscriptionPlans?.[plan]?.[duration];

        if (!price) {
            return res.status(400).json({
                message: "Invalid plan or duration"
            });
        }

        const startDate = new Date();
        const endDate = new Date(startDate);
        if (duration === "monthly") {
            endDate.setMonth(endDate.getMonth() + 1);
        }
        if (duration === "sixMonths") {
            endDate.setMonth(endDate.getMonth() + 6);
        }
        if (duration === "yearly") {
            endDate.setFullYear(endDate.getFullYear() + 1);
        }

        const subscription = await subscriptionModel.create({
            userId: req.user.id,
            plan,
            duration,
            price,
            paymentMethod: "Razorpay",
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            paymentStatus: "paid",
            subscriptionStatus: "active",
            startDate,
            endDate
        });

        // Payment is genuine
        return res.status(200).json({
            message: "Payment verified successfully and subscription activated",
            subscription
        });

    } catch (error) {
        console.log("Verify payment error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};