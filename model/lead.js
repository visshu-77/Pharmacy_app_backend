import mongoose from "mongoose";

const leadSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true
        },
        customerName: { type: String, required: true, trim: true, maxlength: 120 },
        companyName: { type: String, trim: true, maxlength: 120, default: "" },
        mobileNumber: { type: String, required: true, trim: true, maxlength: 20 },
        mobileNumberNormalized: { type: String, default: "" },
        alternateNumber: { type: String, trim: true, maxlength: 20, default: "" },
        email: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
        emailNormalized: { type: String, default: "" },
        whatsappNumber: { type: String, trim: true, maxlength: 20, default: "" },
        address: { type: String, trim: true, maxlength: 300, default: "" },
        city: { type: String, trim: true, maxlength: 100, default: "" },
        state: { type: String, trim: true, maxlength: 100, default: "" },
        pincode: { type: String, trim: true, maxlength: 12, default: "" },
        title: { type: String, required: true, trim: true, maxlength: 160 },
        source: { type: String, required: true, trim: true, maxlength: 60 },
        category: { type: String, trim: true, maxlength: 60, default: "" },
        interestedProduct: { type: String, trim: true, maxlength: 160, default: "" },
        expectedBudget: { type: Number, min: 0, default: null },
        expectedDealValue: { type: Number, min: 0, default: null },
        finalQuotationAmount: { type: Number, min: 0, default: null },
        finalAmount: { type: Number, min: 0, default: null },
        priority: {
            type: String,
            default: "Medium"
        },
        statusId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/leadStatuses",
            required: true
        },
        statusName: { type: String, required: true, trim: true, maxlength: 40 },
        statusColor: { type: String, required: true, match: /^#[0-9a-fA-F]{6}$/ },
        assignedEmployee: { type: String, trim: true, maxlength: 120, default: "" },
        description: { type: String, trim: true, maxlength: 3000, default: "" },
        notes: { type: String, trim: true, maxlength: 5000, default: "" },
        leadDate: { type: Date, required: true, default: Date.now },
        nextFollowUpAt: { type: Date, default: null },
        lostReason: { type: String, default: "", maxlength: 80 },
        lostRemarks: { type: String, default: "", maxlength: 2000 },
        lostAt: { type: Date, default: null },
        convertedAt: { type: Date, default: null },
        legacyFollowUpImported: { type: Boolean, default: false },
        isMerged: { type: Boolean, default: false },
        mergedInto: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/leads",
            default: null
        },
        mergedAt: { type: Date, default: null },
        mergedByUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            default: null
        }
    },
    { timestamps: true }
);

leadSchema.index({ userId:  1, createdAt: -1 });
leadSchema.index({ userId: 1, statusId: 1, createdAt: -1 });
leadSchema.index({ userId: 1, source: 1, createdAt: -1 });
leadSchema.index({ userId: 1, assignedEmployee: 1 });
leadSchema.index({ userId: 1, nextFollowUpAt: 1 });
leadSchema.index({ userId: 1, customerName: 1 });
leadSchema.index({ userId: 1, isMerged: 1, leadDate: -1 });
leadSchema.index({ userId: 1, mobileNumber: 1 });
leadSchema.index({ userId: 1, email: 1 });
leadSchema.index({ userId: 1, mobileNumberNormalized: 1 });
leadSchema.index({ userId: 1, emailNormalized: 1 });
leadSchema.index({ userId: 1, isMerged: 1, leadDate: 1, source: 1 });
leadSchema.index({ userId: 1, isMerged: 1, leadDate: 1, statusId: 1 });
leadSchema.index({ userId: 1, isMerged: 1, leadDate: 1, assignedEmployee: 1 });

export default mongoose.model("dashboard/leads", leadSchema);
