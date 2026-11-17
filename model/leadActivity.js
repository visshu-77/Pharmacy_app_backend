import mongoose from "mongoose";

const leadActivitySchema = new mongoose.Schema(
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
            enum: [
                "created", "updated", "status_changed", "call_made", "whatsapp_message",
                "email_sent", "meeting_completed", "notes_added", "followup_scheduled",
                "followup_updated", "employee_reassigned", "lead_converted", "lead_lost", "lead_merged"
            ],
            required: true
        },
        message: { type: String, required: true, maxlength: 240 },
        description: { type: String, default: "", maxlength: 2000 },
        previousStatus: { type: String, default: "" },
        newStatus: { type: String, default: "" },
        changedBy: { type: String, default: "" },
        changedByUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            default: null
        }
    },
    { timestamps: true }
);

leadActivitySchema.index({ userId: 1, leadId: 1, createdAt: -1 });

export default mongoose.model("dashboard/leadActivities", leadActivitySchema);
