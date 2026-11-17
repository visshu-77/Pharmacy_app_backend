import mongoose from "mongoose";

const leadConversionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true
        },
        leadId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/leads",
            required: true,
            unique: true
        },
        referenceId: { type: String, required: true, unique: true, maxlength: 48 },
        finalDealAmount: { type: Number, required: true, min: 0 },
        incomeRecordedAmount: { type: Number, min: 0, default: 0 },
        conversionDate: { type: Date, required: true },
        notes: { type: String, trim: true, maxlength: 2000, default: "" },
        responsibleEmployee: { type: String, trim: true, maxlength: 120, default: "" }
    },
    { timestamps: true }
);

leadConversionSchema.index({ userId: 1, conversionDate: -1 });

export default mongoose.model("dashboard/leadConversions", leadConversionSchema);
