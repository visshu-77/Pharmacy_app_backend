import mongoose from "mongoose";

const leadSettingsSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true,
            unique: true
        },
        sources: { type: [String], default: [] },
        categories: { type: [String], default: [] },
        lostReasons: { type: [String], default: [] },
        priorities: { type: [String], default: [] },
        followUpTypes: { type: [String], default: [] }
    },
    { timestamps: true }
);

export default mongoose.model("dashboard/leadSettings", leadSettingsSchema);
