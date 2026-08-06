import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true
        },

        plan: {
            type: String,
            enum: ["normal", "premium", "business"],
            required: true
        },

        duration: {
            type: String,
            enum: ["monthly", "sixMonths", "yearly"],
            required: true
        },

        price: {
            type: Number,
            required: true
        },

        paymentMethod: {
            type: String,
            required: true
        },

        razorpayOrderId: {
            type: String
        },

        razorpayPaymentId: {
            type: String
        },

        paymentStatus: {
            type: String,
            enum: ["pending", "paid", "failed"],
            default: "pending"
        },

        subscriptionStatus: {
            type: String,
            enum: ["active", "pending", "expired", "cancelled"],
            default: "pending"
        },

        startDate: {
            type: Date
        },

        endDate: {
            type: Date
        }
    },
    {
        timestamps: true
    }
);

const subscription = mongoose.model(
    "dashboard/subscriptions",
    subscriptionSchema
);

export default subscription;