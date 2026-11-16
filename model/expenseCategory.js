import mongoose from "mongoose";

const expenseCategorySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true,
            index: true
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 60
        },
        normalizedName: {
            type: String,
            required: true
        },
        type: {
            type: String,
            enum: ["expense", "investment", "income"],
            required: true
        },
        isDefault: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

expenseCategorySchema.index(
    { userId: 1, type: 1, normalizedName: 1 },
    { unique: true }
);

export default mongoose.model("dashboard/expenseCategories", expenseCategorySchema);
