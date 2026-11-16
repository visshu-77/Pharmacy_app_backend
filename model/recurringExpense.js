import mongoose from "mongoose";

const recurringExpenseSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true,
            index: true
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120
        },
        type: {
            type: String,
            enum: ["expense", "income", "investment"],
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
            required: true
        },
        paymentMethod: {
            type: String,
            enum: ["Cash", "UPI", "Bank Transfer", "Credit Card", "Debit Card", "Other"],
            required: true
        },
        frequency: {
            type: String,
            enum: ["daily", "weekly", "monthly"],
            required: true
        },
        startDate: { type: Date, required: true },
        endDate: { type: Date, default: null },
        nextRunDate: { type: Date, required: true },
        description: { type: String, default: "", trim: true, maxlength: 2000 },
        active: { type: Boolean, default: true }
    },
    { timestamps: true }
);

recurringExpenseSchema.index({ userId: 1, active: 1, nextRunDate: 1 });

export default mongoose.model("dashboard/recurringExpenses", recurringExpenseSchema);
