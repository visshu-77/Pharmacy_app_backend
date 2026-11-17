import mongoose from "mongoose";

const expenseTransactionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120
        },
        type: {
            type: String,
            enum: ["expense", "income", "investment", "refund", "transfer"],
            required: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0.01,
            max: 100000000
        },
        categoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/expenseCategories",
            default: null
        },
        paymentMethod: {
            type: String,
            enum: ["Cash", "UPI", "Bank Transfer", "Credit Card", "Debit Card", "Other"],
            required: true
        },
        transactionDate: {
            type: Date,
            required: true
        },
        description: {
            type: String,
            default: "",
            trim: true,
            maxlength: 2000
        },
        recurrenceKey: {
            type: String,
            default: undefined
        },
        recurringRuleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/recurringExpenses",
            default: null
        },
        sourceConversionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/leadConversions",
            default: undefined
        },
        sourceEventKey: {
            type: String,
            maxlength: 120,
            default: undefined
        },
        receipt: {
            fileName: { type: String, maxlength: 255 },
            contentType: { type: String, enum: ["image/jpeg", "image/png", "image/webp", "application/pdf"] },
            data: Buffer
        }
    },
    { timestamps: true }
);

expenseTransactionSchema.index({ userId: 1, transactionDate: -1 });
expenseTransactionSchema.index({ userId: 1, type: 1, transactionDate: -1 });
expenseTransactionSchema.index({ userId: 1, categoryId: 1, transactionDate: -1 });
expenseTransactionSchema.index(
    { recurrenceKey: 1 },
    { unique: true, sparse: true }
);
expenseTransactionSchema.index(
    { sourceConversionId: 1 },
    { sparse: true }
);
expenseTransactionSchema.index(
    { sourceEventKey: 1 },
    { unique: true, sparse: true }
);

export default mongoose.model("dashboard/expenseTransactions", expenseTransactionSchema);
