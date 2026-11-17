import mongoose from "mongoose";

const leadFollowUpSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true
        },
        leadId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/leads",
            required: true
        },
        type: {
            type: String,
            required: true
        },
        scheduledAt: { type: Date, required: true },
        assignedEmployee: { type: String, trim: true, maxlength: 120, default: "" },
        reminderMinutes: { type: Number, enum: [0, 15, 60, 1440], default: 0 },
        description: { type: String, trim: true, maxlength: 2000, default: "" },
        status: {
            type: String,
            enum: ["Pending", "Completed", "Rescheduled", "Cancelled"],
            default: "Pending"
        },
        legacyImport: { type: Boolean, default: false },
        rescheduledTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/leadFollowUps",
            default: null
        },
        completedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

leadFollowUpSchema.index({ userId: 1, status: 1, scheduledAt: 1 });
leadFollowUpSchema.index({ userId: 1, leadId: 1, scheduledAt: -1 });
leadFollowUpSchema.index(
    { userId: 1, leadId: 1 },
    { unique: true, partialFilterExpression: { legacyImport: true } }
);

export default mongoose.model("dashboard/leadFollowUps", leadFollowUpSchema);
