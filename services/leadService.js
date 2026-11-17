import mongoose from "mongoose";
import leadStatusModel from "../model/leadStatus.js";
import { getLeadSettings } from "./leadSettingsService.js";

export const DEFAULT_LEAD_STATUSES = [
    ["New Lead", "#2563eb"],
    ["Not Contacted", "#64748b"],
    ["Contacted", "#0891b2"],
    ["No Response", "#f59e0b"],
    ["Interested", "#7c3aed"],
    ["Not Interested", "#64748b"],
    ["Follow-up Required", "#ea580c"],
    ["Follow-up Scheduled", "#0d9488"],
    ["Qualified", "#16a34a"],
    ["Proposal Sent", "#4f46e5"],
    ["Negotiation", "#9333ea"],
    ["On Hold", "#78716c"],
    ["Completed", "#0d9488"],
    ["Converted / Won", "#15803d"],
    ["Lost", "#dc2626"],
    ["Invalid Lead", "#6b7280"],
    ["Duplicate Lead", "#475569"]
].map(([name, color], order) => ({
    name,
    color,
    order,
    systemKey: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
}));

export const validObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const parseDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

export const seedLeadStatuses = async (userId) => {
    await leadStatusModel.bulkWrite(
        DEFAULT_LEAD_STATUSES.map((status) => ({
            updateOne: {
                filter: status.systemKey === "completed"
                    ? { userId, $or: [{ systemKey: status.systemKey }, { name: /^completed$/i }] }
                    : { userId, systemKey: status.systemKey },
                update: { $setOnInsert: { ...status, userId } },
                upsert: true
            }
        })),
        { ordered: false }
    );
    const completedStatus = await leadStatusModel.findOne({ userId, systemKey: "completed" }).select("_id");
    if (completedStatus) {
        await leadStatusModel.updateOne({ _id: completedStatus._id }, { $set: { active: true } });
    } else {
        await leadStatusModel.updateOne(
            { userId, name: /^completed$/i },
            { $set: { systemKey: "completed", active: true } }
        );
    }
};

export const isCompletedStatus = (status) =>
    status?.systemKey === "completed" || String(status?.name || "").trim().toLowerCase() === "completed";

export const validateCompletedAmounts = (input) => {
    const parseAmount = (value, label) => {
        if (value == null || !["number", "string"].includes(typeof value) ||
            (typeof value === "string" && !value.trim())) {
            return { error: `${label} is required` };
        }
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount < 0 || amount > 10000000000 ||
            Math.round(amount * 100) / 100 !== amount) {
            return { error: `${label} must be a non-negative amount with up to two decimal places` };
        }
        return { value: amount };
    };
    const quotation = parseAmount(input.finalQuotationAmount, "Final quotation amount");
    const finalAmount = parseAmount(input.finalAmount, "Final amount");
    if (quotation.error || finalAmount.error) return { error: quotation.error || finalAmount.error };
    return { values: { finalQuotationAmount: quotation.value, finalAmount: finalAmount.value } };
};

const optionalText = (value, maxLength) => {
    const text = String(value ?? "").trim();
    return text.length <= maxLength ? text : null;
};

export const validateLeadPayload = async (payload, userId, existingStatusId = null) => {
    const customerName = optionalText(payload.customerName, 120);
    const title = optionalText(payload.title, 160);
    const mobileNumber = optionalText(payload.mobileNumber, 20);
    const source = optionalText(payload.source, 60);
    const priority = String(payload.priority || "Medium");

    if (!customerName) return { error: "Customer name is required and must be 120 characters or fewer" };
    if (!title) return { error: "Lead title is required and must be 160 characters or fewer" };
    if (!mobileNumber || !/^[+\d() .-]{7,20}$/.test(mobileNumber)) {
        return { error: "Enter a valid mobile number" };
    }
    if (!source) return { error: "Choose a lead source" };
    const settings = await getLeadSettings(userId);
    if (!settings.priorities.includes(priority)) return { error: "Choose a valid priority" };
    if (!settings.sources.includes(source)) return { error: "Choose a valid lead source" };
    const category = optionalText(payload.category, 60);
    if (category === null || (category && !settings.categories.includes(category))) {
        return { error: "Choose a valid lead category" };
    }
    if (!validObjectId(payload.statusId)) return { error: "Choose a valid lead status" };

    const status = await leadStatusModel.findOne({
        _id: payload.statusId,
        userId,
        ...(String(payload.statusId) === String(existingStatusId) ? {} : { active: true })
    });
    if (!status) return { error: "The selected lead status is unavailable" };
    const completedAmounts = isCompletedStatus(status) ? validateCompletedAmounts(payload) : null;
    if (completedAmounts?.error) return { error: completedAmounts.error };

    const email = optionalText(payload.email, 254);
    if (email === null || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        return { error: "Enter a valid email address" };
    }

    const pincode = optionalText(payload.pincode, 12);
    if (pincode === null || (pincode && !/^[\dA-Za-z -]{3,12}$/.test(pincode))) {
        return { error: "Enter a valid pincode" };
    }

    const amount = (value, label) => {
        if (value === "" || value == null) return { value: null };
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0 || number > 10000000000) {
            return { error: `${label} must be a non-negative amount` };
        }
        return { value: Math.round(number * 100) / 100 };
    };
    const budget = amount(payload.expectedBudget, "Expected budget");
    const dealValue = amount(payload.expectedDealValue, "Expected deal value");
    if (budget.error || dealValue.error) return { error: budget.error || dealValue.error };

    const leadDate = payload.leadDate ? parseDate(payload.leadDate) : new Date();
    if (!leadDate) return { error: "Choose a valid lead creation date" };
    const hasNextFollowUp = Object.prototype.hasOwnProperty.call(payload, "nextFollowUpAt");
    const nextFollowUpAt = payload.nextFollowUpAt ? parseDate(payload.nextFollowUpAt) : null;
    if (payload.nextFollowUpAt && !nextFollowUpAt) return { error: "Choose a valid follow-up date" };

    const fields = {
        companyName: 120, alternateNumber: 20, whatsappNumber: 20, address: 300,
        city: 100, state: 100, interestedProduct: 160, assignedEmployee: 120,
        description: 3000, notes: 5000
    };
    const values = {};
    for (const [field, max] of Object.entries(fields)) {
        const value = optionalText(payload[field], max);
        if (value === null) return { error: `${field} must be ${max} characters or fewer` };
        if (["alternateNumber", "whatsappNumber"].includes(field) && value && !/^[+\d() .-]{7,20}$/.test(value)) {
            return { error: `Enter a valid ${field === "alternateNumber" ? "alternate" : "WhatsApp"} number` };
        }
        values[field] = value;
    }

    return {
        values: {
            ...values,
            customerName,
            title,
            mobileNumber,
            mobileNumberNormalized: mobileNumber.replace(/\D/g, ""),
            email: email.toLowerCase(),
            emailNormalized: email.toLowerCase(),
            pincode,
            source,
            category,
            priority,
            expectedBudget: budget.value,
            expectedDealValue: dealValue.value,
            ...(completedAmounts?.values || {}),
            statusId: status._id,
            statusName: status.name,
            statusColor: status.color,
            leadDate,
            ...(hasNextFollowUp ? { nextFollowUpAt } : {})
        },
        status
    };
};
