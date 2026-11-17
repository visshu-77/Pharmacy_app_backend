import mongoose from "mongoose";

const leadStatusSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true
        },
        name: { type: String, required: true, trim: true, maxlength: 40 },
        color: { type: String, required: true, match: /^#[0-9a-fA-F]{6}$/ },
        order: { type: Number, default: 0 },
        active: { type: Boolean, default: true },
        systemKey: { type: String, default: null }
    },
    { timestamps: true }
);

leadStatusSchema.index({ userId: 1, name: 1 }, { unique: true });
leadStatusSchema.index({ userId: 1, order: 1 });
leadStatusSchema.index(
    { userId: 1, systemKey: 1 },
    { unique: true, partialFilterExpression: { systemKey: { $type: "string" } } }
);

export default mongoose.model("dashboard/leadStatuses", leadStatusSchema);
