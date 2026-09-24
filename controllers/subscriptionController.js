import subscriptionModel from "../model/subscription.js";
import razorpay from "../config/razorpay.js";
import crypto from "crypto";
import { subscriptionPlans } from "../config/subscriptionPlans.js";

import { sendSubscriptionThankYouEmail } from "../services/emailService.js";
import { calculateEndDate, resolveSubscription } from "../services/subscriptionService.js";

import userModel from "../model/users.js";
import transporter from "../config/mail.js";


export const createSubscription = async (req, res) => {
    try {
        const {
            plan = "pro",
            duration,
            paymentMethod
        } = req.body;

        // Never trust a client-sent price.
        const price = subscriptionPlans?.[plan]?.[duration];

        if (!price) {
            return res.status(400).json({
                message: "Invalid plan or duration"
            });
        }

        const startDate = new Date();
        const endDate = calculateEndDate(startDate, duration);

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

        // Razorpay can call back twice (retries, double taps). One payment,
        // one subscription.
        const alreadyRecorded = await subscriptionModel.findOne({
            razorpayPaymentId: razorpay_payment_id
        });

        if (alreadyRecorded) {
            return res.status(200).json({
                message: "Payment already verified",
                subscription: alreadyRecorded
            });
        }

        // Renewing early? Queue the new period after everything already
        // paid for, so no days are lost.
        const { accessEndsAt } = await resolveSubscription(req.user.id);

        const startDate = accessEndsAt ? new Date(accessEndsAt) : new Date();

        const subscriptionStatus = accessEndsAt ? "pending" : "active";

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
            // The payment and subscription are already saved — a failed
            // thank-you email must not tell the customer their payment failed.
            console.log("Subscription email failed:", emailErr.message);
        }

        // Payment is genuine
        return res.status(200).json({
            message:"Payment verified successfully and subscription activated",
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
        const { current, upcoming, accessEndsAt } =
            await resolveSubscription(req.user.id);

        // When nothing is active, tell the app about the plan that ended most
        // recently so it can say "ended 5 days ago — your data is safe".
        // Expiry never deletes data; it only pauses access until renewal.
        const lastEnded = current
            ? null
            : await subscriptionModel
                .findOne({
                    userId: req.user.id,
                    paymentStatus: "paid",
                    endDate: { $lte: new Date() }
                })
                .sort({ endDate: -1 })
                .select("plan duration endDate");

        return res.status(200).json({
            hasSubscription: Boolean(current),
            subscription: current,
            upcoming,
            accessEndsAt,
            lastEnded,
            serverTime: new Date()
        });

    } catch (error) {

        console.log("Get subscription error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};
