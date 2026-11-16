import mongoose from "mongoose";

const cashReceiptSchema = new mongoose.Schema(
    {
        receiptNumber: {
            type: String,
            required: true,
            trim: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true
        },
        recipient: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120
        },
        amount: {
            type: Number,
            min: 0.01
        },
        totalAmount: {
            type: Number,
            required: true,
            min: 0.01
        },
        cashReceived: {
            type: Number,
            required: true,
            min: 0.01
        },
        remainingAmount: {
            type: Number,
            required: true,
            min: 0
        },
        paymentMethod: {
            type: String,
            enum: ["Cash"],
            default: "Cash"
        }
    },
    { timestamps: true }
);

cashReceiptSchema.index({ userId: 1, receiptNumber: 1 }, { unique: true });
cashReceiptSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model("dashboard/cashReceipts", cashReceiptSchema);
