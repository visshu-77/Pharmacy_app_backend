import subscriptionModel from "../model/subscription.js";
import razorpay from "../config/razorpay.js";
import crypto from "crypto";
import { subscriptionPlans } from "../config/subscriptionPlans.js";

import { sendSubscriptionThankYouEmail } from "../services/emailService.js";

import userModel from "../model/users.js";
import transporter from "../config/mail.js";


const calculateEndDate = (startDate, duration) => {
    const endDate = new Date(startDate);

    if (duration === "monthly") {
        endDate.setMonth(endDate.getMonth() + 1);
    } else if (duration === "sixMonths") {
        endDate.setMonth(endDate.getMonth() + 6);
    } else if (duration === "yearly") {
        endDate.setFullYear(endDate.getFullYear() + 1);
    }

    return endDate;
};

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

        const user = await userModel.findById(req.user.id);

        if (!user) {
            return res.status(404).json({
                message: "user not found"
            })
        }

        const price = subscriptionPlans?.[plan]?.[duration];

        if (!price) {
            return res.status(400).json({
                message: "Invalid plan or duration"
            });
        }

        const existingSubscription =
            await subscriptionModel.findOne({
                userId: req.user.id,
                paymentStatus: "paid",
                subscriptionStatus: {
                    $in: ["active", "pending"]
                },
                endDate: {
                    $gt: new Date()
                }
            }).sort({
                endDate: -1
            });


        const startDate = existingSubscription
            ? new Date(existingSubscription.endDate)
            : new Date();

        const subscriptionStatus =
            existingSubscription
                ? "pending"
                : "active";

        const endDate = calculateEndDate(startDate, duration);

        const subscription = await subscriptionModel.create({
            userId: req.user.id,
            plan,
            duration,
            price,
            paymentMethod: "Razorpay",
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            paymentStatus: "paid",
            subscriptionStatus,
            startDate,
            endDate
        });


        try {
            await sendSubscriptionThankYouEmail({
                email: user.email,
                ownerName: user.ownerName,
                plan,
                duration,
                price,
                startDate,
                endDate
            })
        } catch (emailErr) {
            console.log(emailErr);
            return res.status(500).json({
                message: "Email Error"
            })
        }

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

export const getMySubscription = async (req, res) => {
    try {
        const userId = req.user.id;
        const now = new Date();

        // 1. Mark all expired active subscriptions as expired
        await subscriptionModel.updateMany(
            {
                userId,
                paymentStatus: "paid",
                subscriptionStatus: "active",
                endDate: { $lte: now }
            },
            {
                $set: {
                    subscriptionStatus: "expired"
                }
            }
        );

        // 2. Find currently active subscription
        let activeSubscription =
            await subscriptionModel.findOne({
                userId,
                paymentStatus: "paid",
                subscriptionStatus: "active",
                startDate: { $lte: now },
                endDate: { $gt: now }
            }).sort({
                endDate: -1
            });

        // 3. If active subscription exists
        if (activeSubscription) {
            return res.status(200).json({
                hasSubscription: true,
                subscription: activeSubscription
            });
        }

        // 4. Find next pending subscription
        const pendingSubscription =
            await subscriptionModel.findOne({
                userId,
                paymentStatus: "paid",
                subscriptionStatus: "pending",
                startDate: { $lte: now }
            }).sort({
                startDate: 1
            });

        // 5. Activate pending subscription
        if (pendingSubscription) {

            pendingSubscription.subscriptionStatus = "active";

            await pendingSubscription.save();

            return res.status(200).json({
                hasSubscription: true,
                subscription: pendingSubscription
            });
        }

        // 6. No subscription
        return res.status(200).json({
            hasSubscription: false,
            subscription: null
        });

    } catch (error) {

        console.log("Get subscription error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};