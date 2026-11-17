import mongoose from "mongoose";

const leadNotificationSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true
        },
        leadId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/leads",
            default: null
        },
        followUpId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/leadFollowUps",
            default: null
        },
        kind: {
            type: String,
            enum: ["lead_assigned", "lead_reassigned", "followup_upcoming", "followup_overdue", "lead_converted", "lead_lost"],
            required: true
        },
        title: { type: String, required: true, maxlength: 100 },
        message: { type: String, required: true, maxlength: 240 },
        eventKey: { type: String, required: true, maxlength: 160 },
        readAt: { type: Date, default: null }
    },
    { timestamps: true }
);

leadNotificationSchema.index({ userId: 1, createdAt: -1 });
leadNotificationSchema.index({ userId: 1, eventKey: 1 }, { unique: true });

export default mongoose.model("dashboard/leadNotifications", leadNotificationSchema);
